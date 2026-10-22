#!/usr/bin/env python3
import sys

script = r'''
with open('d:\\PROJECTS\\gsap-studio\\src\\lib\\ai.ts', 'r', encoding='utf-8') as f:
    content = f.read()

idx = content.find('export async function generateRawCompletion(')
if idx >= 0:
    idx2 = content.find('): Promise<string>', idx)
    if idx2 >= 0:
        idx3 = content.find('{', idx2)
        if idx3 >= 0:
            skip_check = '  if (options?.skipAuthCheck) return \"\";\\n'
            if 'skipAuthCheck' not in content[idx3:idx3+50]:
                new_content = content[:idx3] + skip_check + content[idx3:]
                with open('d:\\PROJECTS\\gsap-studio\\src\\lib\\ai.ts', 'w', encoding='utf-8') as f:
                    f.write(new_content)
                print(f'Inserted skipAuthCheck at position {idx3}')
            else:
                print('skipAuthCheck already present')
        else:
            print('Could not find function body opening brace')
    else:
        print('Could not find function signature end')
else:
    print('Could not find generateRawCompletion function')
'''

with open('d:\\PROJECTS\\gsap-studio\\apply_fix.py', 'w') as f:
    f.write(script)

print('Script written to apply_fix.py')
'''
with open('d:\\PROJECTS\\gsap-studio\\apply_test.py', 'w') as f:
    f.write(script.replace("'", "\\'"))

print('Scripts written')