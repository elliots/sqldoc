import type { NamespacePlugin } from '@sqldoc/core'

const plugin: NamespacePlugin = {
  apiVersion: 1,
  name: 'lint',
  tags: {
    ignore: {
      description: 'Suppress a lint rule on this object. Reason is mandatory.',
      targets: ['table', 'column', 'view', 'function'],
      args: [{ type: 'string' }, { type: 'string' }],
    },
  },
}

export default plugin
