
import json
from ollama import chat
from venue_tools import calculate_venue_cost


# 1. Register the available Python functions
tools = {
    "calculate_venue_cost": calculate_venue_cost
}


# 2. Define the conversation
messages = [
    {
        "role": "system",
        "content": (
            "You are Knotiqo's wedding planning assistant. "
            "Always respond in Hebrew. "
            "Use available tools for calculations. "
            "Never invent calculation results."
        ),
    },
    {
        "role": "user",
        "content": (
            "כמה יעלה אולם ל-250 אורחים "
            "במחיר 350 שקלים למנה?"
        ),
    },
]


# 3. Send the question and available tools to Ollama
response = chat(
    model="qwen3:4b",
    messages=messages,
    tools=[calculate_venue_cost],
)


# 4. Check if the model requested a tool
if not response.message.tool_calls:
    print("AI:", response.message.content)
    raise SystemExit(0)


# 5. Save the assistant's tool call in the conversation
messages.append(response.message)


# 6. Execute the tools requested by the model
for call in response.message.tool_calls:
    function = tools.get(call.function.name)

    if function is None:
        raise ValueError("Unknown tool")

    arguments = call.function.arguments

    result = function(**arguments)

    print("Tool:", call.function.name)
    print("Result:", result)

    messages.append({
        "role": "tool",
        "tool_name": call.function.name,
        "content": json.dumps(result),
    })


# 7. Send the tool result back to the model
final_response = chat(
    model="qwen3:4b",
    messages=messages,
    tools=[calculate_venue_cost],
)


# 8. Print the final answer
print("\nAI:", final_response.message.content)
