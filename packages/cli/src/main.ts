/**
 * CLI entry point. Parses argv and runs the matched command.
 * This is the file invoked by `node` or the sqldoc binary's delegate.
 * The actual program setup lives in index.ts (side-effect-free).
 */
import { run } from './index.ts'

run()
