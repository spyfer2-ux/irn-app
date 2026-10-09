#!/usr/bin/env python3
"""Encerra servidores locais de teste (workerd/wrangler/google de teste) sem derrubar o próprio terminal."""
import os, signal
me = {os.getpid(), os.getppid()}
alvos = ('workerd', 'wrangler-dist', 'wrangler.js', 'bin/wrangler', 'fake-google.mjs')
for pid in os.listdir('/proc'):
    if not pid.isdigit() or int(pid) in me:
        continue
    try:
        cmd = open(f'/proc/{pid}/cmdline', 'rb').read().replace(b'\0', b' ').decode(errors='ignore')
    except OSError:
        continue
    if any(a in cmd for a in alvos) and 'stop-servers' not in cmd and 'bash -c' not in cmd:
        try:
            os.kill(int(pid), signal.SIGTERM)
            print('parado', pid, cmd[:80])
        except OSError:
            pass
