#!/usr/bin/env python3

filepath = "d:\\PROJECTS\\gsap-studio\\src\\lib\\ai.ts"
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# Replace the options type with a simpler string replacement
old_opts = 'options?: { provider?: AIProvider }'
new_opts = 'options?: { provider?: AIProvider; skipAuthCheck?: boolean }'

if old_opts in content:
    content = content.replace(old_opts, new_opts)
    print("Updated options type")
else:
    print("Options type not found")

# Find the generateRawCompletion function and add the skipAuthCheck at the start of the body
func_start = content.find('export async function generateRawCompletion(')
if func_start >= 0:
    print(f"Found generateRawCompletion at position {func_start}")
    
    # Find the function body start (after the signature)
    sig_end = content.find('): Promise<string>', func_start)
    if sig_end >= 0:
        print(f"Found function signature end at position {sig_end}")
        
        # Insert the skipAuthCheck at the start of the function body
        skip_line = '  if (options?.skipAuthCheck) return "";\n'
        body_start = content.find('{', sig_end)
        if body_start >= 0:
            # Check if the skip check already exists
            if 'skipAuthCheck' not in content[func_start:sig_end + 50]:
                # Insert the skip check
                new_content = content[:body_start] + skip_line + content[body_start:]
                # Also update the options type in the new content
                if old_opts in new_content:
                    new_content = new_content.replace(old_opts, new_opts)
                    print("Updated options type in function")
                
                with open(filepath, 'w', encoding='utf-8') as f:
                    f.write(new_content)
                print("File updated successfully - skipAuthCheck inserted")
            else:
                print("skipAuthCheck already present in function")
        else:
            print("Could not find function body start")
    else:
        print("Could not find function signature end")
else:
    print("Could not find generateRawCompletion function")