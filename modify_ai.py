import re

with open('d:\\PROJECTS\\gsap-studio\\src\\lib\\ai.ts', 'r') as f:
    content = f.read()

# Find the generateRawCompletion function and add skipAuthCheck option
# Look for the function parameters

# First, let's find where generateRawCompletion is defined
pattern = r'export async function generateRawCompletion\('
match = re.search(pattern, content)
if match:
    print(f'Found at position: {match.start()}')
else:
    print('Not found')