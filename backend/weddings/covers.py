import logging
from struct import error as StructError
from hashlib import sha256
from io import BytesIO
from uuid import uuid4

from django.core.files.base import ContentFile
from django.db import DatabaseError, transaction
from django.db.models.signals import pre_delete
from django.dispatch import receiver
from django.shortcuts import get_object_or_404
from django.urls import reverse
from PIL import Image, ImageOps, UnidentifiedImageError

from .models import Wedding
from .services import weddings_for_user


MAX_BYTES = 5 * 1024 * 1024
MAX_PIXELS = 20_000_000
FORMATS = ("JPEG", "PNG", "WEBP")
logger = logging.getLogger(__name__)


class CoverError(Exception):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


def cover_url(wedding):
    if not wedding.cover_image:
        return None
    version = sha256(wedding.cover_image.name.encode()).hexdigest()[:16]
    return reverse("wedding-cover", args=[wedding.pk]) + f"?v={version}"


def normalize_cover(upload):
    if upload.size > MAX_BYTES:
        raise CoverError("too_large")
    try:
        with Image.open(upload, formats=FORMATS) as image:
            if image.width * image.height > MAX_PIXELS:
                raise CoverError("unsafe_dimensions")
            if getattr(image, "is_animated", False):
                raise CoverError("invalid_image")
            image.verify()
        upload.seek(0)
        with Image.open(upload, formats=FORMATS) as image:
            image.load()
            with ImageOps.exif_transpose(image) as oriented, oriented.convert("RGB") as rgb:
                rgb.thumbnail((2560, 2560), Image.Resampling.LANCZOS)
                rgb.info.clear()
                output = BytesIO()
                rgb.save(output, "WEBP", quality=86)
    except Image.DecompressionBombError as error:
        raise CoverError("unsafe_dimensions") from error
    except (UnidentifiedImageError, OSError, ValueError, SyntaxError, OverflowError, StructError) as error:
        raise CoverError("invalid_image") from error
    return ContentFile(output.getvalue())


def delete_file(storage, name):
    if name:
        try:
            storage.delete(name)
        except Exception:
            logger.exception("Wedding cover storage cleanup failed")


@receiver(pre_delete, sender=Wedding)
def delete_wedding_cover(sender, instance, using, **kwargs):
    # The instance being deleted may predate a cover replacement.
    name = sender.objects.using(using).select_for_update().filter(pk=instance.pk).values_list(
        "cover_image", flat=True,
    ).first()
    if name:
        storage = sender._meta.get_field("cover_image").storage
        transaction.on_commit(lambda: delete_file(storage, name), using=using)


def replace_cover(*, user, wedding_id, content=None):
    storage = Wedding._meta.get_field("cover_image").storage
    new_name = ""
    try:
        with transaction.atomic(durable=True):
            wedding = get_object_or_404(
                weddings_for_user(user=user).select_for_update(of=("self",)), pk=wedding_id,
            )
            old_name = wedding.cover_image.name
            if content is not None:
                new_name = f"wedding-covers/{uuid4().hex}.webp"
                try:
                    new_name = storage.save(new_name, content)
                except Exception as error:
                    raise CoverError("storage_unavailable") from error
            wedding.cover_image = new_name
            wedding.save(update_fields=["cover_image"])
            transaction.on_commit(lambda: delete_file(storage, old_name))
    except Exception as error:
        if new_name:
            try:
                # A connection can fail during COMMIT. Keep the file if the
                # database confirms it is active or its outcome is unknown.
                in_use = Wedding.objects.filter(pk=wedding_id, cover_image=new_name).exists()
            except DatabaseError:
                logger.exception("Unable to verify wedding cover after transaction failure")
            else:
                if not in_use:
                    delete_file(storage, new_name)
        if isinstance(error, DatabaseError):
            raise CoverError("storage_unavailable") from error
        raise
    return wedding
