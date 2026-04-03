import schema_pb2
from google.protobuf.timestamp_pb2 import Timestamp

passed = 0
failed = 0

def assert_eq(actual, expected, msg):
    global passed, failed
    if actual == expected:
        print(f"  PASS: {msg}")
        passed += 1
    else:
        print(f"  FAIL: {msg} (expected {expected!r}, got {actual!r})")
        failed += 1

# --- User round-trip ---
print("User:")
user = schema_pb2.User()
user.id = 1
user.email = "alice@example.com"
user.name = "Alice"
user.age = 30
user.is_active = True
user.tags.append("admin")
user.tags.append("editor")
user.balance = "99.95"
user.external_id = "550e8400-e29b-41d4-a716-446655440000"
ts = Timestamp()
ts.FromJsonString("2024-01-15T10:30:00Z")
user.created_at.CopyFrom(ts)

data = user.SerializeToString()
assert_eq(len(data) > 0, True, "serialized user is non-empty")

user2 = schema_pb2.User()
user2.ParseFromString(data)
assert_eq(user2.id, 1, "user id round-trips")
assert_eq(user2.email, "alice@example.com", "user email round-trips")
assert_eq(user2.name, "Alice", "user name round-trips")
assert_eq(user2.age, 30, "user age round-trips")
assert_eq(user2.is_active, True, "user is_active round-trips")
assert_eq(list(user2.tags), ["admin", "editor"], "user tags round-trip")
assert_eq(user2.balance, "99.95", "user balance round-trips")
assert_eq(user2.external_id, "550e8400-e29b-41d4-a716-446655440000", "user external_id round-trips")

# --- ContentPost round-trip ---
print("ContentPost:")
post = schema_pb2.ContentPost()
post.id = 1
post.user_id = 1
post.title = "Hello World"
post.body = "This is my first post."
post.view_count = 42
post.rating = 4.5
pub_ts = Timestamp()
pub_ts.FromJsonString("2024-06-01T12:00:00Z")
post.published_at.CopyFrom(pub_ts)

data = post.SerializeToString()
post2 = schema_pb2.ContentPost()
post2.ParseFromString(data)
assert_eq(post2.id, 1, "post id round-trips")
assert_eq(post2.user_id, 1, "post user_id round-trips")
assert_eq(post2.title, "Hello World", "post title round-trips")
assert_eq(post2.body, "This is my first post.", "post body round-trips")
assert_eq(post2.view_count, 42, "post view_count round-trips")
assert_eq(post2.rating, 4.5, "post rating round-trips")

# --- Comment round-trip ---
print("Comment:")
comment = schema_pb2.Comment()
comment.id = 1
comment.post_id = 1
comment.user_id = 1
comment.content = "Great post!"
ct = Timestamp()
ct.FromJsonString("2024-06-02T08:00:00Z")
comment.created_at.CopyFrom(ct)

data = comment.SerializeToString()
comment2 = schema_pb2.Comment()
comment2.ParseFromString(data)
assert_eq(comment2.id, 1, "comment id round-trips")
assert_eq(comment2.post_id, 1, "comment post_id round-trips")
assert_eq(comment2.user_id, 1, "comment user_id round-trips")
assert_eq(comment2.content, "Great post!", "comment content round-trips")

# --- Optional field test ---
print("Optional fields:")
post_no_rating = schema_pb2.ContentPost()
post_no_rating.id = 2
post_no_rating.user_id = 1
post_no_rating.title = "No Rating"
post_no_rating.body = "Post without optional fields"
post_no_rating.view_count = 0

data = post_no_rating.SerializeToString()
post3 = schema_pb2.ContentPost()
post3.ParseFromString(data)
assert_eq(post3.HasField("rating"), False, "optional rating absent when not set")
assert_eq(post3.HasField("published_at"), False, "optional published_at absent when not set")

# --- Summary ---
print(f"\n{passed} passed, {failed} failed")
if failed > 0:
    exit(1)
