#!/usr/bin/env python3
import sys

filepath = "d:\\PROJECTS\\gsap-studio\\src\\lib\\ai.ts"
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()

# Find and modify the module-level diagnostic code
# The diagnostic code runs when window is undefined (Node.js tests)
# We need to make it skip the check in test mode

# Option 1: Add a check for a test environment variable
old_diag = '''if (typeof window === "undefined") {
  // One-time diagnostic so you can confirm which provider and key the server
  // is actually using (visible in the next dev terminal output). Never throws:
  // missing keys surface as configuration_error at request time.
  try {
    console.log(
      `[gsap-studio] AI provider: ${resolveProvider()} · key prefix: ${(providerApiKey(resolveProvider()).slice(0, 12))}...`,
    );
  } catch {
    console.log(`[gsap-studio] AI provider: ${resolveProvider()} · key: missing`);
  }
}'''

new_diag = '''if (typeof window === "undefined") {
  // Skip diagnostic in test mode (no OPENROUTER_API_KEY)
  if (process.env.OPENROUTER_API_KEY) {
    try {
      console.log(
        `[gsap-studio] AI provider: ${resolveProvider()} · key prefix: ${(providerApiKey(resolveProvider()).slice(0, 12))}...`,
      );
    } catch {
      console.log(`[gsap-studio] AI provider: ${resolveProvider()} · key: missing`);
    }
  }
}'''

if old_diag in content:
    content = content.replace(old_diag, new_diag)
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)
    print("Successfully modified module-level diagnostic code")
else:
    print("Could not find the exact diagnostic code pattern")
    # Try simpler check
    if 'typeof window === "undefined"' in content:
        print('Found window check, but pattern did not match exactly')