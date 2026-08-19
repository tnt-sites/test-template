import { visit } from "unist-util-visit";

const YOUTUBE_URL_PATTERN =
  /^(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/i;

function extractYoutubeId(url) {
  const match = url.trim().match(YOUTUBE_URL_PATTERN);

  return match ? match[1] : null;
}

/**
 * Converts a paragraph containing only a YouTube link (bare URL or a
 * markdown link) into a `<Video>` embed. Links that appear alongside other
 * text are left untouched, since turning those into a block-level embed
 * would break up the surrounding sentence.
 */
export default function remarkYoutubeEmbed() {
  return (tree, file) => {
    const postTitle = file?.data?.astro?.frontmatter?.title;

    visit(tree, "paragraph", (node, index, parent) => {
      if (!parent || index === null || node.children.length !== 1) return;

      const [child] = node.children;
      const url = child.type === "link" ? child.url : child.type === "text" ? child.value : null;

      if (!url) return;

      const videoId = extractYoutubeId(url);

      if (!videoId) return;

      parent.children[index] = {
        type: "mdxJsxFlowElement",
        name: "Video",
        attributes: [
          { type: "mdxJsxAttribute", name: "type", value: "youtube" },
          { type: "mdxJsxAttribute", name: "id", value: videoId },
          { type: "mdxJsxAttribute", name: "title", value: postTitle || "YouTube video" },
        ],
        children: [],
      };
    });
  };
}
