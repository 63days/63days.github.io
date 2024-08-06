import json
# with open("prompts.txt", "r") as f:
#     lines = [line.strip().strip(",").strip("\"")for line in f]

# for i, line in enumerate(lines):
#     if line[-1] != ".":
#         lines[i] = line+"."

# with open("prompts.json", "w") as f:
#     json.dump(lines, f, indent=4)

with open("prompts.json") as f:
    prompts = json.load(f)


