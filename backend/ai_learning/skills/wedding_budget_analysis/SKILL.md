
---
name: wedding-budget-analysis
description: Analyze wedding costs, remaining budget, and financial risks.
---

# Wedding Budget Analysis

## Purpose
Help couples understand their wedding budget using
verified calculations and clear recommendations.

## When to use
Use this skill when the user asks about:
- Wedding expenses
- Venue costs
- Remaining budget
- Budget overruns
- Comparing wedding costs

## Workflow
1. Identify the total budget and known expenses.
2. Identify the number of guests and meal price.
3. Use calculate_venue_cost to calculate meal costs.
4. Use calculate_remaining_budget to calculate the remaining budget.
5. Check whether the budget is exceeded.
6. Explain the result in Hebrew.

## Rules
- Always use available calculation tools.
- Never invent missing prices or expenses.
- Ask for missing information when it is required.
- Do not assume that the meal price includes all venue fees.
- If the remaining budget is negative, clearly warn about the overrun.
- Distinguish confirmed costs from estimates.
- Provide practical recommendations based on the available data.

## Response format
Provide:
1. Total budget
2. Known expenses
3. Remaining budget
4. Budget status
5. One practical recommendation
