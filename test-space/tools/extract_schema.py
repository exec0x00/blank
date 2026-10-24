"""Extract protobuf descriptors from a user-provided Claude HAR, without credentials."""
import base64
import json
import re
import sys
from pathlib import Path
from google.protobuf import descriptor_pb2

def extract(path, destination):
    found = {}
    for entry in json.loads(Path(path).read_text(encoding='utf-8'))['log']['entries']:
        content = entry['response'].get('content', {})
        if 'javascript' not in content.get('mimeType', ''):
            continue
        text = content.get('text', '')
        if content.get('encoding') == 'base64':
            text = base64.b64decode(text).decode('utf-8', 'replace')
        for match in re.finditer(r'"([A-Za-z0-9+/=]{100,})"', text):
            try:
                raw = base64.b64decode(match[1] + '=' * (-len(match[1]) % 4), validate=True)
                fd = descriptor_pb2.FileDescriptorProto.FromString(raw)
                if fd.name.endswith('.proto') and (fd.message_type or fd.enum_type):
                    found[fd.name] = fd
            except Exception:
                continue
    result = descriptor_pb2.FileDescriptorSet()
    for name in sorted(found):
        result.file.add().CopyFrom(found[name])
    Path(destination).parent.mkdir(parents=True, exist_ok=True)
    Path(destination).write_bytes(result.SerializeToString())
    print('Extracted', len(found), 'schema files; no request or session data saved.')

if __name__ == '__main__':
    extract(sys.argv[1], sys.argv[2])
