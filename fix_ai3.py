#!/usr/bin/env python3
import re

filepath = "d:\\PROJECTS\\gsap-studio\\src\\lib\\ai.ts"
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# Find generateRawCompletion function and add skipAuthCheck
# Pattern: the function body starts after the signature
# We'll insert the skip check right after the function opens

# First ensure the options type has skipAuthCheck
old_opts = 'options?: { provider?: AIProvider }'
new_opts = 'options?: { provider?: AIProvider; skipAuthCheck?: boolean }'

if old_opts in content:
    content = content.replace(old_opts, new_opts)
    print("Updated options type")

# Find and modify the generateRawCompletion function
# Look for the pattern: the function returns a string and has providerApiKey call
# We'll insert the skip check at the very beginning of the function body

# Strategy: find "): Promise<string> {" followed by the function body
# and insert the skip check as the first line

# Actually, let's find the function by looking for the providerApiKey call inside it
# The generateRawCompletion function calls: providerApiKey(resolveProvider())

# Let's search for this pattern and add the skip check before it
skip_check_pattern = '  if (options?.skipAuthCheck) return "";'

# Find the generateRawCompletion function
# It should have: options?.provider and providerApiKey calls
gen_start = content.find('export async function generateRawCompletion(')
if gen_start >= 0:
    print(f"Found generateRawCompletion at position {gen_start}")
    
    # Find the function signature end
    sig_end = content.find('): Promise<string>', gen_start)
    if sig_end >= 0:
        print(f"Found signature end at {sig_end}")
        
        # Find the function body opening brace
        body_open = content.find('{', sig_end)
        if body_open >= 0:
            print(f"Found body open at {body_open}")
            
            # Get the function body
            func_body = content[body_open:body_open + 200]
            print(f"Function body starts: {func_body[:100]}")
            
            # Check if skipAuthCheck is already there
            if 'skipAuthCheck' not in content[gen_start:body_open + 200]:
                # Insert the skip check as the first line of the function body
                # We need to insert after the opening brace
                insert_pos = body_open + 1  # After the {
                new_content = content[:insert_pos] + skip_check_pattern + '\n' + content[insert_pos:]
                with open(filepath, 'w', encoding='utf-8') as f:
                    f.write(new_content)
                print("Inserted skipAuthCheck at start of function body")
            else:
                print("skipAuthCheck already present")
        else:
            print("Could not find function body open brace")
    else:
        print("Could not find signature end")
else:
    print("Could not find generateRawCompletion function")