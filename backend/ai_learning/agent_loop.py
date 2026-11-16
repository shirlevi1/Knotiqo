

import json
from ollama import chat

from venue_tools import (
    calculate_venue_cost,
    calculate_remaining_budget,
)

MODEL = "qwen3:4b"
MAX_ROUNDS = 5

# Allowed tools
tools = {
    "calculate_venue_cost": calculate_venue_cost,
    "calculate_remaining_budget": calculate_remaining_budget,
}

messages = [
    {
        "role": "system",
        "content": (
            "You are Knotiqo's wedding budget assistant. "
            "Always respond in Hebrew. "
            "Use tools for calculations. "
            "After receiving tool results, provide a final answer in Hebrew. "
            "Do not return an empty response. "
            "Do not invent numbers."
        ),
    },
    {
        "role": "user",
        "content": (
            "יש לי תקציב של 150000 ש״ח, "
            "250 אורחים במחיר 350 ש״ח למנה, "
            "ועוד הוצאות בסך 40000 ש״ח. "
            "כמה יישאר לי אחרי כל ההוצאות?"
        ),
    },
]

for round_number in range(MAX_ROUNDS):
    response = chat(
        model=MODEL,
        messages=messages,
        tools=list(tools.values()),
    )

    messages.append(response.message)

    calls = response.message.tool_calls or []

    # No more tools needed — finish

    if not calls:
        answer = response.message.content

        if answer and answer.strip():
            print("\nAI:", answer)
            break

        print("The model returned an empty response.")
        print("Response:", response.message)
        break


    # Execute each requested tool
    for call in calls:
        tool_name = call.function.name
        function = tools.get(tool_name)

        if function is None:
            raise ValueError(f"Unknown tool: {tool_name}")

        arguments = call.function.arguments

        # Only allow numerical parameters
        if not isinstance(arguments, dict):
            raise ValueError("Invalid arguments")

        if any(
                type(value) not in (int, float)
                or not (-1e12 <= value <= 1e12)
                for value in arguments.values()
        ):
            raise ValueError("Invalid numeric arguments")

        result = function(**arguments)

        print(f"Round {round_number + 1}")
        print(f"Tool: {tool_name}")
        print(f"Arguments: {arguments}")
        print(f"Result: {result}")

        messages.append({
            "role": "tool",
            "tool_name": tool_name,
            "content": json.dumps(result),
        })

else:
    print("Agent stopped: maximum rounds reached.")
