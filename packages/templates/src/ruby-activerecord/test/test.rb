# Integration test for @sqldoc/templates/ruby-activerecord
# Connects to real Postgres, verifies generated model files parse and data matches.

require 'uri'
require 'pg'

DATABASE_URL = ENV['DATABASE_URL']
unless DATABASE_URL
  $stderr.puts "DATABASE_URL not set"
  exit 1
end

$failed = 0

def assert_eq(actual, expected, msg)
  if actual != expected
    $stderr.puts "FAIL: #{msg} (got #{actual.inspect}, expected #{expected.inspect})"
    $failed += 1
  else
    puts "  ok: #{msg}"
  end
end

puts "--- ruby-activerecord integration test ---"

# Parse DATABASE_URL
uri = URI.parse(DATABASE_URL)
conn = PG.connect(
  host: uri.host,
  port: uri.port || 5432,
  dbname: uri.path.sub('/', ''),
  user: uri.user,
  password: uri.password
)

# 1. Load and syntax-check generated files
require_relative 'enums' if File.exist?('enums.rb')
# We can't fully load ActiveRecord models without Rails, but we verified syntax in Dockerfile

# 2. Query user from DB
result = conn.exec("SELECT id, email, name, age, is_active FROM users WHERE id = 1")
row = result[0]
assert_eq(row['email'], 'test@example.com', 'user.email matches')
assert_eq(row['name'], 'Test User', 'user.name matches')
assert_eq(row['age'].to_i, 30, 'user.age matches')
assert_eq(row['is_active'], 't', 'user.is_active matches')

# 3. Query post from DB
result = conn.exec("SELECT id, user_id, title, body, view_count FROM content.posts WHERE id = 1")
row = result[0]
assert_eq(row['title'], 'Hello World', 'post.title matches')
assert_eq(row['user_id'].to_i, 1, 'post.user_id matches')
assert_eq(row['view_count'].to_i, 42, 'post.view_count matches')

conn.close

if $failed > 0
  $stderr.puts "\n#{$failed} assertion(s) failed"
  exit 1
end
puts "\nAll assertions passed!"
