import subprocess
import sys

result = subprocess.run(
    [sys.executable, "-m", "tsx", "test/m36-planning-routes.test.ts"],
    cwd="d:\\PROJECTS\\gsap-studio",
    capture_output=True,
    text=True
)
print("STDOUT:")
print(result.stdout)
print("STDERR:")
print(result.stderr)
print("Return code:", result.returncode)