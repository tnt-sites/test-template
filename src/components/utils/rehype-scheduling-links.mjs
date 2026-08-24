import { isSchedulingLink } from "./scheduling-links.ts";

/**
 * Opens links to the practice's online booking in a new tab, for anchors that
 * come from markdown bodies rather than from a component.
 *
 * Components spread `schedulingLinkAttrs` onto the anchors they render, but a
 * blog post's prose is authored as markdown, so its links never pass through
 * one. This applies the same rule to them at build time, which means a post
 * written next month is covered without the author remembering to say so.
 */
export default function rehypeSchedulingLinks() {
  return (tree) => {
    const visit = (node) => {
      if (node.type === "element" && node.tagName === "a" && isSchedulingLink(node.properties?.href)) {
        node.properties.target = "_blank";
        node.properties.rel = "noopener noreferrer";
      }

      for (const child of node.children ?? []) visit(child);
    };

    visit(tree);
  };
}
