import { VPCarbon } from 'vitepress-carbon'
import type { Theme } from 'vitepress'
import SqlTransform from './components/SqlTransform.vue'
import DialectBadge from './components/DialectBadge.vue'
import PluginCard from './components/PluginCard.vue'
import TemplateCard from './components/TemplateCard.vue'
import CommunityCallout from './components/CommunityCallout.vue'
import HomepageExample from './components/HomepageExample.vue'

export default {
  extends: VPCarbon,
  enhanceApp({ app }) {
    app.component('SqlTransform', SqlTransform)
    app.component('DialectBadge', DialectBadge)
    app.component('PluginCard', PluginCard)
    app.component('TemplateCard', TemplateCard)
    app.component('CommunityCallout', CommunityCallout)
    app.component('HomepageExample', HomepageExample)
  },
} satisfies Theme
