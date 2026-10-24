"""Typed messages recovered from the user's captured frontend descriptors."""
from pathlib import Path
from google.protobuf import descriptor_pb2, descriptor_pool, message_factory, json_format
from google.protobuf import any_pb2, timestamp_pb2, duration_pb2, empty_pb2, struct_pb2, wrappers_pb2, field_mask_pb2

pool = descriptor_pool.DescriptorPool()
for module in (any_pb2, timestamp_pb2, duration_pb2, empty_pb2, struct_pb2, wrappers_pb2, field_mask_pb2):
    pool.AddSerializedFile(module.DESCRIPTOR.serialized_pb)
files = descriptor_pb2.FileDescriptorSet.FromString((Path(__file__).parent/'schemas/claude.pb').read_bytes()).file
# Buf's embedded descriptor format omits imports. Recover imports by symbol ownership.
owners = {}
def symbols(items, prefix, file):
    for m in items:
        name = prefix + '.' + m.name
        owners[name] = file
        if hasattr(m, 'nested_type'):
            symbols(m.nested_type, name, file)
            symbols(m.enum_type, name, file)
for f in files:
    symbols(f.message_type, '.'+f.package, f.name)
    symbols(f.enum_type, '.'+f.package, f.name)
def refs(messages):
    for m in messages:
        for field in list(m.field)+list(m.extension):
            yield field.type_name
            yield field.extendee
        yield from refs(m.nested_type)
pending = {}
for f in files:
    if f.name.startswith('google/protobuf/'):
        continue
    dependencies = set(f.dependency)
    names = list(refs(f.message_type))
    for service in f.service:
        for method in service.method:
            names.extend((method.input_type, method.output_type))
    for name in names:
        if not name: continue
        owner = owners.get(name)
        if owner is None:
            try: owner = pool.FindMessageTypeByName(name.lstrip('.')).file.name
            except KeyError: continue
        if owner != f.name: dependencies.add(owner)
    del f.dependency[:]
    f.dependency.extend(sorted(dependencies))
    pending[f.name] = f
while pending:
    progress = False
    errors = []
    for name, f in list(pending.items()):
        try: pool.Add(f)
        except Exception as e:
            errors.append(str(e)); continue
        del pending[name]; progress = True
    if not progress: raise RuntimeError('Cannot load captured schema: '+str(errors[:3]))

PREFIX = 'anthropic.bard.api.v1alpha.'
def message(name, **kwargs):
    return message_factory.GetMessageClass(pool.FindMessageTypeByName(PREFIX+name))(**kwargs)
def parse(name, data):
    obj = message(name); obj.ParseFromString(data); return obj
def as_dict(obj):
    return json_format.MessageToDict(obj, preserving_proto_field_name=True)
