
import json
from openai import OpenAI
from venue_tools import calculate_venue_cost

client = OpenAI(
    base_url="http://localhost:11434/v1/",
    api_key="ollama"
)

# Describe the Python tool to the AI model.
tools = [
    {
        "type": "function",
        "name": "calculate_venue_cost",
        "description": "Calculate wedding venue meal cost.",
        "parameters": {
            "type": "object",
            "properties": {
                "guests": {
                    "type": "integer",
                    "description": "Number of guests"
                },
                "price_per_guest": {
                    "type": "number",
                    "description": "Price per guest in ILS"
                }
            },
            "required": ["guests", "price_per_guest"],
            "additionalProperties": False
        },
        "strict": True
    }
]

question = "כמה יעלה אולם ל-250 אורחים במחיר 350 שקל למנה?"

response = client.responses.create(
    model="qwen3:4b",
    instructions=(
        "You are a wedding planning assistant. "
        "Use the provided calculation tool for venue costs. "
        "Answer in Hebrew."
    ),
    input=question,
    tools=tools
)

# Process tool calls requested by the model.
tool_outputs = []

for item in response.output:
    if item.type != "function_call":
        continue

    if item.name != "calculate_venue_cost":
        raise ValueError("Unknown tool requested")

    args = json.loads(item.arguments)

    # Validate arguments before running local code.
    guests = args["guests"]
    price = args["price_per_guest"]

    if (
            type(guests) is not int
            or type(price) not in (int, float)
    ):
        raise ValueError("Invalid tool arguments")

    result = calculate_venue_cost(guests, price)

    print("Tool called:", item.name)
    print("Tool result:", result)

    tool_outputs.append({
        "type": "function_call_output",
        "call_id": item.call_id,
        "output": str(result)
    })

if not tool_outputs:
    raise RuntimeError("Model did not request a tool")

# Give the calculation result back to the model.
final_response = client.responses.create(
    model="gpt-4.1-mini",
    previous_response_id=response.id,
    input=tool_outputs,
    tools=tools,
    instructions="Answer in Hebrew using the calculated result."
)

print("\nAI Response:")
print(final_response.output_text)
