#!/usr/bin/env python3
"""Static dev server for web/ with caching disabled (so edited ES modules always reload)."""
import functools
import http.server
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8642
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'web')


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


http.server.ThreadingHTTPServer(('', PORT), functools.partial(NoCache, directory=ROOT)).serve_forever()
