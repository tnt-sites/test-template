---
_schema: default
title: Search
pageSections:
- _component: page-sections/builders/content-with-sidebar
  main:
  - _component: page-sections/heroes/hero-center
    eyebrow: null
    heading: Search
    subtext: Everything on your site is just one search away. (Free static search courtesy of <a href="https://pagefind.app/"
      target="_blank" rel="noopener">Pagefind</a> 💙)
    buttonSections: []
    colorScheme: default
    backgroundColor: base
    paddingVertical: xl
  - _component: page-sections/builders/custom-section
    label: ''
    contentSections:
    - _component: building-blocks/core-elements/embed
      html: "<link href=\"/pagefind/pagefind-ui.css\" rel=\"stylesheet\">\n<script src=\"/pagefind/pagefind-ui.js\"\
        ></script>\n<div id=\"search\"></div>\n<script>\n  window.addEventListener(\"DOMContentLoaded\"\
        , () => {\n    const ui = new PagefindUI({ element: \"#search\", showSubResults: true });\n  \
        \  // the sidebar search box submits ?q=, so run that query on load\n    const q = new URLSearchParams(location.search).get(\"\
        q\");\n    if (q) ui.triggerSearch(q);\n  });\n</script>\n"
      aspectRatio: landscape
    maxContentWidth: xl
    paddingHorizontal: xl
    paddingVertical: 2xl
    colorScheme: default
    backgroundColor: base
    backgroundImage:
      source: null
      alt: null
      positionVertical: top
      positionHorizontal: center
    rounded: false
  sidebar: []
  maxContentWidth: 2xl
  paddingVertical: xl
---
