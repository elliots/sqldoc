<template>
  <div class="community-callout">
    <div class="community-callout-icon">&#128640;</div>
    <div class="community-callout-content">
      <strong>Created a plugin?</strong>
      <p>
        If you've built a namespace plugin for sqldoc, we'd love to list it here.
        <a href="https://github.com/elliots/sqldoc/issues/new?title=Community+Plugin:+%5Byour+plugin+name%5D&labels=community-plugin" target="_blank">
          Open an issue
        </a>
        and we can add it to this page.
      </p>
    </div>
  </div>
</template>

<style>
.community-callout {
  display: flex;
  gap: 12px;
  padding: 16px 20px;
  background: var(--vp-c-brand-soft);
  border-left: 3px solid var(--vp-c-brand-1);
  border-radius: 4px;
  margin: 24px 0;
}
.community-callout-icon { font-size: 24px; flex-shrink: 0; }
.community-callout-content p {
  margin: 4px 0 0;
  font-size: 14px;
  color: var(--vp-c-text-2);
}
.community-callout-content a {
  color: var(--vp-c-brand-1);
  font-weight: 500;
}
</style>
