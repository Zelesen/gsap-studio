import os
base = r'd:\PROJECTS\gsap-studio'
for root, dirs, files in os.walk(base):
    dirs[:] = [d for d in dirs if d != 'node_modules']
    for f in files:
        path = os.path.join(root, f)
        rel = os.path.relpath(path, base)
        print(rel)