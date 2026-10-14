"use strict";

// Logged-out fallback data source (issue #27). Reddit's firewall now 403s
// anonymous .json requests, but it still serves new Reddit ("shreddit") HTML
// pages and /svc/shreddit/ partials to the same logged-out browser. This file
// turns that HTML into the same shape Reddit's .json API returns, so every
// builder in rebuild.js works unchanged on top of it.
//
// Everything that depends on new Reddit's markup lives in SHREDDIT below — when
// Reddit renames a tag, attribute or slot, fix it there, not in the functions.
// HTML is parsed with an inert DOMParser document (no scripts run, custom
// elements never upgrade), and any markup that reaches the page goes through
// cleanBodyHtml's allowlist first.

(function () {
  const SHREDDIT = {
    post: {
      tag: "shreddit-post",
      attr: {
        fullname: "id",
        title: "post-title",
        url: "content-href",
        permalink: "permalink",
        domain: "domain",
        author: "author",
        score: "score",
        comments: "comment-count",
        created: "created-timestamp",
        subreddit: "subreddit-name",
        type: "post-type",
        nsfw: "nsfw",          // boolean attribute
        spoiler: "spoiler",    // boolean attribute
      },
      // post-type values → how the builders should treat the post
      types: { text: "text", image: "image", gallery: "gallery", video: "video" },
      thumbnail: '[slot="thumbnail"] img',
      flair: "shreddit-post-flair .flair-content",
      textBody: 'shreddit-post-text-body, [slot="text-body"]',
      galleryImages: "gallery-carousel img",
      player: "shreddit-player, shreddit-player-2",
    },
    player: {
      attr: { src: "src", poster: "poster", preview: "preview" },
      vreddit: /^(https:\/\/v\.redd\.it\/[A-Za-z0-9]+)\//i,
    },
    comment: {
      tag: "shreddit-comment",
      attr: {
        fullname: "thingId",
        author: "author",
        score: "score",
        created: "created",
        permalink: "permalink",
        depth: "depth",
      },
      body: '[slot="comment"]',
    },
    more: {
      // a "load more comments" stub: <faceplate-partial src=".../more-comments/..."><input name="cursor">
      stub: 'faceplate-partial[src*="/more-comments/"]',
      cursorInput: 'input[name="cursor"]',
      method: "POST",
      csrfCookie: "csrf_token",
      remainingParam: "comments-remaining", // top-level stub carries the count in its URL
      countText: /(\d[\d,]*)\s+more/i,      // nested stubs say "N more replies"
    },
    feed: {
      // next page of a listing: <faceplate-partial slot="load-after" src="/svc/shreddit/...more-posts...">
      nextPage: 'faceplate-partial[slot="load-after"]',
    },
    // Stickied posts aren't in the feed; new Reddit shows them as "Community
    // highlights": <a href=permalink><community-highlight-card id="highlight_card_t3_…">
    highlight: {
      card: "community-highlight-card",
      id: /^highlight_card_(t3_[a-z0-9]+)$/i,
      subreddit: "subreddit-prefixed-name",
      title: '[slot="title"]',
      author: '[slot="label"] img[alt]',
      counts: '[slot="upvotes-and-comments"] faceplate-number', // votes, then comments
      countAttr: "number",
    },
    // Subreddit sidebar ("right rail"): a header element with the community's
    // basics, then sibling blocks — one per widget, each titled by an <h2>.
    rail: {
      path: "/svc/shreddit/feeds/subreddit-right-rail?name=",
      header: "shreddit-subreddit-header",
      headerAttr: {
        name: "name", prefixedName: "prefixed-name", description: "description",
        weeklyVisitors: "weekly-active-users", weeklyContributions: "weekly-contributions",
      },
      sectionTitle: "h2",
      // widgets whose links all point here are mod-tool listings ("Installed Apps")
      skipIfAllLinksMatch: /^https:\/\/developers\.reddit\.com\/apps\//i,
      // inside a widget, rule titles etc. are <h2>s too — show them as bold text
      bodyRename: { h1: ["strong"], h2: ["strong"] },
    },
    // only ever fetch partials under this path (the listing "after" token is one)
    partialPrefix: "/svc/shreddit/",
    // old-reddit comment sort → new Reddit's ?sort= value
    commentSorts: { best: "confidence", top: "top", new: "new", controversial: "controversial", old: "old", qa: "qa" },
    // Markup allowed through into comment/post bodies. Other elements are
    // unwrapped (children kept); DROP elements are removed with their content.
    body: {
      allow: ["div", "p", "br", "hr", "a", "em", "i", "strong", "b", "del", "s", "sup", "sub", "code", "pre",
        "blockquote", "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6",
        "table", "thead", "tbody", "tr", "th", "td", "span", "img"],
      drop: ["script", "style", "svg", "template", "iframe", "object", "embed", "button", "input",
        "form", "noscript", "textarea", "select", "faceplate-screen-reader-content"],
      rename: { "spoiler-text": ["span", "md-spoiler-text"] },
    },
  };

  function parseDoc(html) {
    return new DOMParser().parseFromString(html, "text/html");
  }

  // New Reddit streams most comments inside <template> elements (e.g.
  // #deferred-comments) that its JS later moves into the tree. DOMParser keeps a
  // template's content in a separate fragment that querySelectorAll never enters,
  // so put those contents back in place. Matched by what they contain, not by id,
  // so a renamed template still works.
  function unwrapTemplates(doc, sel) {
    for (;;) {
      const tpl = Array.from(doc.querySelectorAll("template")).find((t) => t.content.querySelector(sel));
      if (!tpl) return doc;
      tpl.replaceWith(tpl.content);
    }
  }

  function parseCommentsDoc(html) {
    return unwrapTemplates(parseDoc(html), [SHREDDIT.comment.tag, SHREDDIT.more.stub, SHREDDIT.post.tag, SHREDDIT.post.player].join(", "));
  }

  function attr(el, name) {
    const v = el.getAttribute(name);
    return v == null ? "" : v;
  }

  function toInt(v) {
    const n = parseInt(String(v || "").replace(/,/g, ""), 10);
    return isNaN(n) ? null : n;
  }

  // "2026-10-13T17:38:28.022000+0000" → unix seconds. Date.parse doesn't reliably
  // accept a 6-digit fraction or a colon-less offset, so normalize both first.
  function toUnix(ts) {
    if (!ts) return 0;
    const iso = String(ts)
      .replace(/(\.\d{3})\d+/, "$1")
      .replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
    const ms = Date.parse(iso);
    return isNaN(ms) ? 0 : Math.floor(ms / 1000);
  }

  // First element matching sel that belongs to `owner` itself — not to a nested
  // post/comment of the same tag further down (replies nest inside their parent).
  function own(owner, sel, ownerTag) {
    for (const el of owner.querySelectorAll(sel)) {
      if (el.parentElement && el.parentElement.closest(ownerTag) === owner) return el;
    }
    return null;
  }

  function safeUrl(u, allowRelative) {
    const s = String(u || "").trim();
    if (allowRelative && /^\/(?!\/)/.test(s)) return s;
    return /^https?:\/\//i.test(s) ? s : "";
  }

  // Rebuild untrusted markup from scratch with only allowlisted elements and
  // attributes, in an inert document, and return its serialized HTML.
  function cleanBodyHtml(src, extraRename) {
    const B = SHREDDIT.body;
    const rename = Object.assign({}, B.rename, extraRename || {});
    const doc = src.ownerDocument;
    const out = doc.createElement("div");
    const walk = (from, to) => {
      for (const n of Array.from(from.childNodes)) {
        if (n.nodeType === 3) { to.appendChild(doc.createTextNode(n.nodeValue)); continue; }
        if (n.nodeType !== 1) continue;
        const tag = n.tagName.toLowerCase();
        if (B.drop.indexOf(tag) >= 0) continue;
        const ren = rename[tag];
        let name = ren ? ren[0] : tag;
        if (B.allow.indexOf(name) < 0) { walk(n, to); continue; } // unwrap
        // an <li> whose list wrapper got unwrapped would render a stray bullet
        if (name === "li" && !/^(ul|ol)$/i.test(to.tagName)) name = "div";
        const el = doc.createElement(name);
        if (ren && ren[1]) el.className = ren[1];
        if (name === "a") {
          const href = safeUrl(n.getAttribute("href"), true);
          if (href) el.setAttribute("href", href);
        } else if (name === "img") {
          const s = safeUrl(n.getAttribute("src"), false);
          if (!s) continue;
          el.setAttribute("src", s);
          if (n.getAttribute("alt")) el.setAttribute("alt", n.getAttribute("alt"));
        } else if (name === "span" && /\bmd-spoiler-text\b/.test(n.className || "")) {
          el.className = "md-spoiler-text";
        }
        walk(n, el);
        to.appendChild(el);
      }
    };
    walk(src, out);
    return out.innerHTML.trim();
  }

  function mdHtml(el) {
    if (!el) return "";
    const inner = cleanBodyHtml(el);
    return inner ? '<div class="md">' + inner + "</div>" : "";
  }

  // A post's <shreddit-player> → a .json-style media.reddit_video, so the existing
  // v.redd.it code path (dash.js, or its "Watch on Reddit" fallback) handles it.
  // hls_url is Reddit's own signed stream URL, kept for a possible HLS player.
  function videoData(pl) {
    if (!pl) return null;
    const A = SHREDDIT.player.attr;
    const src = safeUrl(pl.getAttribute(A.src), false);
    const m = SHREDDIT.player.vreddit.exec(src);
    if (!m) return null;
    const preview = safeUrl(pl.getAttribute(A.preview), false);
    return {
      rv: {
        fallback_url: SHREDDIT.player.vreddit.test(preview) ? preview : m[1] + "/DASH_720.mp4",
        hls_url: src,
        has_audio: true,
      },
      poster: safeUrl(pl.getAttribute(A.poster), false),
    };
  }

  // One <shreddit-post> → a .json-style t3 data object.
  function postData(el) {
    const P = SHREDDIT.post, A = P.attr;
    const fullname = attr(el, A.fullname);
    const type = attr(el, A.type);
    const sub = attr(el, A.subreddit);
    const permalink = attr(el, A.permalink);
    const isSelf = type === P.types.text;
    const url = safeUrl(attr(el, A.url), true) || permalink;
    const score = toInt(attr(el, A.score));
    const thumbEl = own(el, P.thumbnail, P.tag);
    const flairEl = own(el, P.flair, P.tag);
    const d = {
      name: fullname,
      id: fullname.replace(/^t3_/, ""),
      title: attr(el, A.title),
      url: isSelf ? permalink : url,
      permalink,
      domain: attr(el, A.domain) || (isSelf ? "self." + sub : ""),
      author: attr(el, A.author),
      score: score == null ? 0 : score,
      hide_score: score == null,
      num_comments: toInt(attr(el, A.comments)) || 0,
      created_utc: toUnix(attr(el, A.created)),
      subreddit: sub,
      is_self: isSelf,
      over_18: el.hasAttribute(A.nsfw),
      spoiler: el.hasAttribute(A.spoiler),
      thumbnail: thumbEl ? safeUrl(thumbEl.getAttribute("src"), false) : "",
      link_flair_text: flairEl ? flairEl.textContent.trim() : "",
      selftext_html: isSelf ? mdHtml(own(el, P.textBody, P.tag)) : "",
    };
    if (type === P.types.image) d.post_hint = "image";
    if (type === P.types.video) {
      d.is_video = true;
      const v = videoData(own(el, P.player, P.tag));
      if (v) {
        d.media = { reddit_video: v.rv };
        if (v.poster) d.preview = { images: [{ source: { url: v.poster } }] };
      }
    }
    if (type === P.types.gallery) {
      const srcs = [];
      for (const img of el.querySelectorAll(P.galleryImages)) {
        const s = safeUrl(img.getAttribute("src") || img.getAttribute("data-lazy-src"), false);
        if (s && srcs.indexOf(s) < 0) srcs.push(s);
      }
      if (srcs.length) {
        d.is_gallery = true;
        d.gallery_data = { items: srcs.map((_, i) => ({ media_id: "m" + i })) };
        d.media_metadata = {};
        srcs.forEach((s, i) => { d.media_metadata["m" + i] = { s: { u: s } }; });
      }
    }
    return d;
  }

  function nextPagePath(doc) {
    const el = doc.querySelector(SHREDDIT.feed.nextPage);
    const src = el ? el.getAttribute("src") : "";
    return isPartialPath(src) ? src : null;
  }

  function isPartialPath(p) {
    return typeof p === "string" && p.indexOf(SHREDDIT.partialPrefix) === 0 && p.indexOf("..") < 0;
  }

  // A highlight card has no post time, domain or type — what old Reddit shows
  // for a sticky is mostly its title, so build what the card does carry.
  function highlightData(card) {
    const H = SHREDDIT.highlight;
    const m = H.id.exec(card.id || "");
    const a = card.closest("a[href]");
    const permalink = a ? safeUrl(a.getAttribute("href"), true) : "";
    if (!m || !permalink || permalink[0] !== "/") return null;
    const titleEl = card.querySelector(H.title);
    const authorEl = card.querySelector(H.author);
    const nums = Array.from(card.querySelectorAll(H.counts)).map((n) => toInt(n.getAttribute(H.countAttr)));
    const sub = attr(card, H.subreddit).replace(/^r\//i, "");
    return {
      name: m[1],
      id: m[1].replace(/^t3_/, ""),
      title: titleEl ? titleEl.textContent.replace(/\s+/g, " ").trim() : "",
      url: permalink,
      permalink,
      domain: "self." + sub,
      author: authorEl ? authorEl.getAttribute("alt") : "",
      score: nums[0] == null ? 0 : nums[0],
      hide_score: nums[0] == null,
      num_comments: nums[1] || 0,
      created_utc: 0,
      subreddit: sub,
      is_self: true,
      stickied: true,
    };
  }

  // A listing page or a "more posts" partial → .json-style Listing. `after` is
  // the next partial's path (opaque to callers; pass it back to fetch page 2).
  // opts.highlights: put the subreddit's stickies first, like old Reddit's "hot".
  function listingFromHtml(html, opts) {
    const tag = SHREDDIT.post.tag, H = SHREDDIT.highlight;
    const doc = unwrapTemplates(parseDoc(html), [tag, SHREDDIT.feed.nextPage, SHREDDIT.post.player, H.card].join(", "));
    const posts = Array.from(doc.querySelectorAll(tag))
      .filter((el) => !(el.parentElement && el.parentElement.closest(tag))) // skip a crosspost's embedded original
      .map(postData)
      .filter((d) => d.name);
    const stickies = opts && opts.highlights
      ? Array.from(doc.querySelectorAll(H.card)).map(highlightData)
        .filter((d) => d && d.title && !posts.some((p) => p.name === d.name))
      : [];
    const children = stickies.concat(posts).map((data) => ({ kind: "t3", data }));
    return { kind: "Listing", data: { children, after: nextPagePath(doc), before: null } };
  }

  function stubData(el) {
    const M = SHREDDIT.more;
    const src = el.getAttribute("src") || "";
    const cur = el.querySelector(M.cursorInput);
    let count = null;
    try { count = toInt(new URL(src, "https://x.invalid").searchParams.get(M.remainingParam)); } catch (e) {}
    if (count == null) {
      const m = M.countText.exec(el.textContent || "");
      if (m) count = toInt(m[1]);
    }
    return { orr_src: src, orr_cursor: cur ? cur.value : "", count: count || 0, children: [] };
  }

  // The comments and "more" stubs that sit directly under `owner` (a comment, or
  // null for the top level), in document order, built recursively.
  function commentItems(scope, owner) {
    const C = SHREDDIT.comment, M = SHREDDIT.more;
    const items = [];
    for (const el of (owner || scope).querySelectorAll(C.tag + ", " + M.stub)) {
      const parent = el.parentElement ? el.parentElement.closest(C.tag) : null;
      if (parent !== owner) continue;
      if (el.tagName.toLowerCase() === C.tag) items.push({ kind: "t1", data: commentData(el, scope) });
      else if (isPartialPath(el.getAttribute("src"))) items.push({ kind: "more", data: stubData(el) });
    }
    return items;
  }

  function commentData(el, scope) {
    const C = SHREDDIT.comment, A = C.attr;
    const fullname = attr(el, A.fullname);
    const score = toInt(attr(el, A.score));
    const kids = commentItems(scope, el);
    return {
      name: fullname,
      id: fullname.replace(/^t1_/, ""),
      author: attr(el, A.author),
      score: score == null ? 0 : score,
      score_hidden: score == null,
      created_utc: toUnix(attr(el, A.created)),
      permalink: attr(el, A.permalink),
      depth: toInt(attr(el, A.depth)) || 0,
      body_html: mdHtml(own(el, C.body, C.tag)),
      replies: kids.length ? { kind: "Listing", data: { children: kids } } : "",
    };
  }

  // A comments page → the .json-style [postListing, commentsListing] pair.
  function commentsFromHtml(html) {
    const doc = parseCommentsDoc(html);
    const postEl = doc.querySelector(SHREDDIT.post.tag);
    const post = postEl ? [{ kind: "t3", data: postData(postEl) }] : [];
    return [
      { kind: "Listing", data: { children: post } },
      { kind: "Listing", data: { children: commentItems(doc, null) } },
    ];
  }

  // A "more comments" partial → the comments/stubs it adds at the stub's level.
  function moreCommentsFromHtml(html) {
    return commentItems(parseCommentsDoc(html), null);
  }

  // A subreddit's right-rail partial → { name, prefixedName, description,
  // weeklyVisitors, weeklyContributions, sections: [{ title, html }] }, or null.
  function sidebarFromHtml(html) {
    const R = SHREDDIT.rail, A = R.headerAttr;
    const doc = parseDoc(html);
    const header = doc.querySelector(R.header);
    if (!header) return null;
    const sections = [];
    // the widgets are the header's siblings that carry a title (ads don't)
    for (const block of Array.from(header.parentElement ? header.parentElement.children : [])) {
      const titleEl = block !== header && block.querySelector(R.sectionTitle);
      if (!titleEl) continue;
      const links = Array.from(block.querySelectorAll("a[href]")).map((a) => a.getAttribute("href"));
      if (links.length && links.every((h) => R.skipIfAllLinksMatch.test(h))) continue;
      const title = titleEl.textContent.replace(/\s+/g, " ").trim();
      titleEl.remove();
      const body = cleanBodyHtml(block, R.bodyRename);
      if (title || body) sections.push({ title, html: body });
    }
    return {
      name: attr(header, A.name),
      prefixedName: attr(header, A.prefixedName),
      description: attr(header, A.description),
      weeklyVisitors: toInt(attr(header, A.weeklyVisitors)),
      weeklyContributions: toInt(attr(header, A.weeklyContributions)),
      sections,
    };
  }

  function sidebarPath(sub) {
    return SHREDDIT.rail.path + encodeURIComponent(sub);
  }

  function readCookie(name) {
    const m = new RegExp("(?:^|;\\s*)" + name + "=([^;]*)").exec(document.cookie || "");
    return m ? decodeURIComponent(m[1]) : "";
  }

  // Request options for loading a "more comments" stub the way new Reddit does.
  function moreRequest(cursor) {
    const M = SHREDDIT.more;
    const body = new URLSearchParams({ cursor: cursor || "" });
    const csrf = readCookie(M.csrfCookie);
    if (csrf) body.set(M.csrfCookie, csrf);
    return {
      method: M.method,
      credentials: "include",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "text/html" },
      body: body.toString(),
    };
  }

  function commentSortParam(sort) {
    return SHREDDIT.commentSorts[sort] || null;
  }

  globalThis.ORR_SHREDDIT = {
    SHREDDIT, listingFromHtml, commentsFromHtml, moreCommentsFromHtml, sidebarFromHtml, sidebarPath,
    isPartialPath, moreRequest, commentSortParam, cleanBodyHtml, toUnix,
  };
})();
