# SEO and AI discovery standard

Status: proposed source of truth  
Scope: GlideLingo public website and all indexable public content  
Owner: Product and Growth  
Last reviewed against official platform guidance: 2026-09-04

## Purpose

This document defines how GlideLingo is discovered, understood, indexed, ranked, cited, and measured across traditional
search engines and AI-powered answer systems.

GlideLingo is a multi-language learning platform. The brand must never be positioned as a Greek-only application. Greek
may be the first complete course, but the public information architecture, metadata, and content system must support
additional languages without changing the company-level positioning.

This standard applies to:

- The GlideLingo marketing website at https://glidelingo.com.
- Language, method, product, pricing, download, comparison, and editorial pages.
- Google Search, Google AI Overviews and AI Mode, Bing and Copilot, ChatGPT Search, Perplexity, and other web-grounded
  assistants.
- Humans or agents creating, reviewing, shipping, or updating public pages.

## Non-goals

This document does not claim to reveal a private ranking algorithm. Search providers publish eligibility rules,
high-level ranking principles, crawler controls, and quality guidance, but they do not publish exact signal weights or
query-specific source-selection logic.

This standard also does not authorize:

- Mass publishing generated pages.
- Thin programmatic language pages.
- Invented reviews, credentials, learner outcomes, ratings, statistics, or expert endorsements.
- Claims that GlideLingo produces fluency within a fixed period.
- Publishing a language page before there is useful, accurate, first-party material for that language.
- Keyword stuffing, doorway pages, link schemes, hidden text, scraped content, or manipulative schema.
- Presenting AI as the product's entire value. GlideLingo is a structured learning system with AI used where it improves
  practice, feedback, adaptation, and access.

## Operating model

Search and AI discovery follow the same basic chain:

1. **Discover:** A crawler finds a URL through links, a sitemap, a submitted URL, or an external reference.
2. **Crawl:** The host, robots rules, firewall, and HTTP response permit the crawler to retrieve the page.
3. **Render:** Important content is available as readable HTML and the page works without requiring authentication.
4. **Index:** The engine selects the canonical page and determines that it provides enough value to store.
5. **Rank:** The engine evaluates relevance, quality, originality, authority, usability, freshness, and query context.
6. **Retrieve:** An AI system searches or retrieves relevant indexed passages and supporting sources.
7. **Cite:** The system decides whether the page is useful and reliable enough to support an answer.
8. **Convert:** The visitor understands GlideLingo and takes a measurable product action.

Optimization that skips an earlier stage cannot repair it later. Structured data cannot make an uncrawlable page rank.
A crawler allow rule cannot make a thin page useful. Traffic without a relevant conversion path is not success.

## Brand and search positioning

### Company-level position

GlideLingo is a premium, structured language-learning platform built around helping people use a language in real
conversation.

The company-level promise is:

> Learn a language. Start speaking it.

The supporting product explanation should consistently describe the complete system:

- Structured courses.
- Guided lessons.
- Speaking and conversation practice.
- Useful feedback.
- Targeted review.
- Visible progress toward real capability.

AI may be named when the feature genuinely uses AI. Avoid vague phrases such as "AI-powered everything." Describe the
specific user benefit: adaptive conversation, pronunciation feedback, targeted correction, or personalized review.

### Language-level position

Each supported language receives a dedicated content cluster beneath the GlideLingo brand. Language pages capture
specific demand; they do not redefine the company.

Preferred scalable structure:

- \`/languages/\`
- \`/languages/{language}/\`
- \`/languages/{language}/beginners/\`
- \`/languages/{language}/speaking-practice/\`
- \`/languages/{language}/pronunciation/\`
- \`/languages/{language}/{topic}/\`

A language hub must clearly state its release status. It may be:

- **Available:** The course is usable and the primary CTA starts or downloads it.
- **Preview:** Meaningful public material exists, but the course is not released. The CTA must accurately say join,
  follow, or preview.
- **Unavailable:** Do not publish an indexable acquisition page. A disabled catalog item inside the application is not
  sufficient reason to create a public SEO page.

Do not create duplicate alternatives such as \`/learn-greek/\`, \`/greek-course/\`, and \`/languages/greek/\` for the same
intent. Choose one canonical URL and redirect retired alternatives.

### Product and intent pages

The language directory is supported by product-level pages that remain language-agnostic:

- \`/method/\`
- \`/courses/\`
- \`/speaking-practice/\`
- \`/ai-language-tutor/\`
- \`/review/\`
- \`/progress/\`
- \`/pricing/\`
- \`/download/\`
- \`/about/\`

Each page must own a distinct user question and conversion path. Pages must not exist solely to repeat homepage copy.

## Information architecture rules

Every indexable page must be reachable through ordinary HTML links. The minimum hierarchy is:

- Homepage links to product pillars, the language directory, pricing, about, and editorial content.
- The language directory links to every released or meaningful preview language hub.
- A language hub links to its beginner, speaking, pronunciation, grammar, culture, and use-case material when available.
- Articles link back to their parent hub, at least two related resources, and one relevant product action.
- Breadcrumbs reflect the hierarchy and use the same canonical URLs.
- Footer navigation exposes stable company, product, language, and legal destinations.

Client-side filters may improve browsing, but they must not be the only way to discover a topic. Important categories need
real linked routes rather than JavaScript-only filter states.

## Technical indexing requirements

Every indexable URL must:

- Return HTTP \`200\`.
- Be accessible without signing in.
- Render its primary text in the initial static HTML.
- Permit the relevant crawler in \`robots.txt\`, the CDN, and the web application firewall.
- Declare one absolute self-referencing canonical URL.
- Appear in an XML sitemap using only the canonical URL.
- Be linked from another indexable page.
- Avoid a \`noindex\` directive.
- Avoid redirect chains, soft 404s, duplicate query variants, and conflicting canonicals.
- Use HTTPS.
- Work on mobile, desktop, keyboard navigation, and screen readers.
- Keep the title, heading, visible content, canonical, and structured data consistent.

Pages that should not enter search results must use \`noindex\` where appropriate. Blocking a page in \`robots.txt\` is not
a substitute for \`noindex\`, because a crawler must retrieve the page to read its indexing directive.

### Sitemaps

The Astro sitemap integration remains the canonical sitemap generator.

Sitemaps must:

- Contain only canonical, indexable, HTTP \`200\` pages.
- Exclude drafts, authentication pages, internal previews, duplicate filters, and retired URLs.
- Provide accurate modification dates when the implementation can guarantee them.
- Be referenced from \`robots.txt\`.
- Be submitted in Google Search Console and Bing Webmaster Tools.

### Redirects and host consistency

The canonical production host is \`https://glidelingo.com\`.

- HTTP must redirect to HTTPS.
- \`www.glidelingo.com\` must permanently redirect to the apex host while preserving path and query string.
- Retired public URLs must redirect once to the nearest relevant replacement.
- Never redirect every missing page to the homepage.
- Canonicals do not replace required redirects.

## Page metadata contract

Every indexable page requires:

- A unique title that explains the page's subject and, where useful, the user outcome.
- A unique description written for the searcher rather than as a list of keywords.
- Exactly one visible primary \`h1\`.
- An absolute canonical URL.
- Open Graph title, description, URL, type, and image.
- Twitter/X card metadata.
- A descriptive social image and alt text.
- Correct language declaration on the root HTML element.
- Published and modified dates for editorial pages.
- Visible author identity for editorial pages.

Titles and headings should use the language real learners use. Brand phrasing can remain emotionally strong, but it
cannot be so abstract that the page's topic is unclear.

The homepage must describe GlideLingo as a language-learning platform. Language-specific terms belong on their respective
language hubs and supporting pages.

## Structured data contract

Structured data is a machine-readable description of visible content. It can improve understanding and eligibility for
supported search features; it does not guarantee ranking or a rich result.

Use JSON-LD and keep it generated from the same page data used for visible content.

Required types by page:

| Page type | Required structured data |
| --- | --- |
| Homepage | \`Organization\`, \`WebSite\`, and \`SoftwareApplication\` when the visible product data supports it |
| Product or download | \`SoftwareApplication\` and visible \`Offer\` data when applicable |
| Editorial article | \`BlogPosting\` or \`Article\` |
| Hierarchical content | \`BreadcrumbList\` |
| First-party product video | \`VideoObject\` when all required visible properties exist |
| Language course list | \`ItemList\`; use Google-supported course markup only when the page and offering satisfy its current rules |

Rules:

- Markup must never contain claims, prices, ratings, availability, authors, or dates absent from the visible page.
- Do not add \`AggregateRating\` without genuine first-party ratings that users can inspect.
- Do not add FAQ markup merely to chase a rich result. Visible questions should exist because they help learners.
- Validate eligible markup with Google's Rich Results Test and Schema.org Validator.
- Schema identifiers should be stable absolute URLs.
- The Organization entity should use consistent name, URL, logo, and verified \`sameAs\` profiles.

## Content quality standard

A page is publishable only when it satisfies a real user need better than a generic summary.

### Required editorial anatomy

A substantial guide should include, when appropriate:

1. A direct answer near the beginning.
2. A clear explanation of who the page is for.
3. Original examples using the language being taught.
4. Actionable steps or a decision framework.
5. Context, limitations, and common mistakes.
6. Links to first-party practice or relevant product capability.
7. Sources for factual, linguistic, scientific, or comparative claims.
8. Author, reviewer, published date, and updated date.
9. Related internal resources.
10. A clear next action.

Not every article needs the same visual template. The information must remain easy to scan and individual sections should
answer specific subquestions clearly enough to stand on their own.

### Experience, expertise, authority, and trust

GlideLingo should demonstrate quality through evidence, not labels.

Strong evidence includes:

- Native-speaker-reviewed examples and audio.
- Named linguistic or curriculum review.
- Real screenshots and first-party product demonstrations.
- Transparent explanations of the learning method.
- Original exercises and interactive tools.
- Carefully anonymized aggregate learning observations.
- Honest product limitations and release status.
- Corrections and meaningful update history.
- Primary or authoritative sources where factual support is needed.

An "expert reviewed" badge without a real reviewer, review scope, and process is prohibited.

### AI-assisted content

AI may assist with research organization, outlines, editing, metadata variants, and coverage checks. A qualified human
must remain accountable for the published page.

Before publication, verify:

- Every factual claim.
- Every translation, transliteration, stress mark, pronunciation description, and grammatical example.
- Every product and pricing claim.
- Every cited source.
- Every internal and external link.
- That the page contains original value beyond what an unconstrained model would produce.

Do not publish large numbers of generated pages without original value. Google's published guidance identifies scaled
low-value generation as potential spam regardless of whether a human or AI produced it.

## AI answer-engine discovery

There is no separate guaranteed "AI SEO" ranking formula. AI visibility begins with the same crawlability, indexing,
relevance, quality, and authority required for search.

Content becomes easier to retrieve and cite when it:

- Names its subject clearly.
- Gives a direct, self-contained answer.
- Uses descriptive headings.
- Defines terms before relying on them.
- Supports claims with accessible sources.
- Contains concrete examples and first-party evidence.
- Keeps essential information in text rather than only in images or video.
- Uses stable canonical URLs.
- Is internally linked from a coherent topic cluster.
- Is updated when its factual or product state changes.

Do not create hidden summaries, prompt injection text, crawler-only copy, or claims aimed at manipulating generated
answers.

### OpenAI crawler policy

OpenAI documents separate crawler purposes:

- \`OAI-SearchBot\` supports website inclusion in ChatGPT Search.
- \`GPTBot\` controls potential use in training OpenAI foundation models.
- \`ChatGPT-User\` supports user-triggered page visits and is not the automatic search crawler.

Search inclusion and training permission are independent choices. GlideLingo's search-discovery requirement is to allow
\`OAI-SearchBot\`. Product leadership must make and document the separate \`GPTBot\` training decision.

The current wildcard allow rule permits OAI-SearchBot at the robots layer. Production operations must also verify that
Cloudflare bot controls, firewall rules, rate limits, or challenges do not block the official user agent and published IP
ranges.

### Other answer systems

For Bing and Copilot:

- Verify the domain in Bing Webmaster Tools.
- Submit the canonical sitemap.
- Keep links, canonicals, modification signals, and content structure accurate.
- Consider IndexNow when publishing frequency makes faster update notification valuable.

For Perplexity:

- Allow \`PerplexityBot\` when citation visibility is desired.
- Verify that the CDN or WAF permits its official user agent and current published IP ranges.

For Anthropic:

- Treat model-training crawlers, search integrations, and user-triggered retrieval as separate controls.
- Review the current official crawler documentation before changing access policy.

Crawler user agents and IP ranges can change. Never copy an unofficial static IP list into this document or infrastructure.
Use the provider's current official endpoint during implementation and operational review.

### \`llms.txt\`

An \`llms.txt\` file is optional experimentation, not a substitute for HTML, robots controls, sitemaps, internal links, or
quality content. Google explicitly states that no special AI text file is required for eligibility in its AI search
features. Do not prioritize \`llms.txt\` ahead of the required work in this standard.

## Multilingual and multi-region rules

GlideLingo teaches multiple languages, but that does not automatically make the marketing website multilingual.

When localized marketing pages are introduced:

- Use one stable URL per locale.
- Set the correct document language.
- Add reciprocal \`hreflang\` annotations and an \`x-default\` where appropriate.
- Localize the full user experience, not only keywords or navigation labels.
- Use qualified translators or reviewers.
- Keep canonicals within the same locale unless the localized page is truly a duplicate.
- Do not automatically redirect crawlers or users solely by inferred IP address.
- Do not publish machine-translated pages without linguistic review and product value.

A page teaching Greek in English is still an English document. Its HTML language should remain English unless the page's
primary interface and prose are Greek.

## Performance, accessibility, and media

Search performance is not reduced to one score, but the site must provide a strong page experience.

Requirements:

- Maintain good Core Web Vitals at representative mobile percentiles.
- Reserve image and video dimensions to prevent layout shift.
- Compress images and provide responsive sizes.
- Lazy-load below-the-fold media.
- Keep primary content usable without autoplay.
- Provide captions for meaningful video and transcripts when they improve access or discovery.
- Preserve semantic headings, landmarks, descriptive controls, keyboard use, contrast, and reduced-motion support.
- Avoid intrusive interstitials and avoid blocking the primary content behind a download prompt.
- Keep third-party scripts minimal and explicitly permitted by the content security policy.

The product walkthrough should have a crawlable descriptive section or transcript. A video without accompanying text
cannot carry the complete product explanation.

## Authority and distribution

On-page optimization establishes relevance. External references help search and answer systems establish that the entity
and material matter.

Acceptable authority-building includes:

- Useful public tools, pronunciation references, and original learning resources worth linking to.
- Partnerships with qualified teachers, linguists, cultural organizations, and relevant creators.
- Accurate listings in software, education, and app directories.
- First-party research or transparent aggregate product findings.
- Interviews, contributed expertise, and legitimate editorial coverage.
- Consistent company identity across the website, GitHub, app stores, and verified social profiles.

Prohibited authority-building includes paid link schemes, mass guest-post exchanges, private blog networks, automated
comment links, fake profiles, and fabricated citations.

## Measurement

SEO and AI discovery must be evaluated as an acquisition system, not by raw page count.

### Required setup

- Google Search Console domain verification.
- Bing Webmaster Tools verification.
- Submitted sitemap in both platforms.
- Production logs or analytics that can identify landing page, referrer, campaign, and conversion without weakening the
  site's security or privacy posture.
- Search referral tracking, including ChatGPT referrals where available.
- A documented conversion event for download, account creation, course start, and paid upgrade.
- A small fixed query set used for repeatable search and AI citation checks.

The current website content security policy uses \`connect-src 'none'\`. Any client analytics integration requires a
deliberate CSP and privacy review. Cloudflare or server-side measurement may be used instead.

### Primary metrics

- Valid indexed canonical pages.
- Non-brand impressions and clicks by intent cluster.
- Ranking distribution for relevant language and product queries.
- Organic and AI-referral visitors who download, create an account, start a course, or subscribe.
- Conversion rate by landing page and query intent.
- Referring domains earned through legitimate coverage.
- Share of a fixed query set in which GlideLingo is cited or linked by relevant answer systems.
- Content decay: pages losing impressions, accuracy, or conversion because they are stale.

Do not use domain-authority scores from third-party tools as a company goal. They may support investigation, but they are
not provider-owned ranking metrics.

## Current main-branch audit

As of 2026-09-04, the Astro website already has a useful technical base:

- Static HTML output.
- Canonical URL support.
- Unique title and description props.
- Open Graph and Twitter metadata.
- XML sitemap integration.
- A permissive robots file referencing the sitemap.
- Semantic page structure, skip navigation, image dimensions, and video captions.
- Seven published editorial pages.

The largest current gaps are:

1. No indexable language directory or language hubs.
2. Homepage language is broad but does not fully explain the structured system or specific AI-supported benefits.
3. Editorial pages are broad essays with limited search-intent targeting, first-party evidence, sourcing, authorship,
   reviewer information, or contextual internal links.
4. No JSON-LD structured data.
5. No visible author, modified date, breadcrumb, or related-content system.
6. No indexable topic/category routes beyond the blog index.
7. No RSS feed.
8. No repository-visible Search Console or Bing verification; external verification state remains to be checked.
9. No implemented organic or AI-referral measurement, and the current CSP blocks ordinary client analytics connections.
10. CDN/WAF access for legitimate search and AI crawlers remains an external production verification gate.

## Strategy to compete for number-one visibility

No document, vendor, or implementation can guarantee the number-one result for a query. Ranking is query-dependent,
location-dependent, device-dependent, and continuously recalculated. The operating target is therefore:

> Become the most useful, demonstrable, and externally validated answer for the highest-value language-learning
> questions, win narrow intent clusters first, and use that authority to compete for broader category terms.

### Strategic thesis

GlideLingo should not attempt to win by publishing the most pages or repeating "AI language tutor" more often than
competitors. The defensible path is to own the intersection competitors usually separate:

1. A structured course with a trustworthy next step.
2. Real speaking and conversation practice.
3. Feedback that identifies what changed and what to do next.
4. Review that makes language available during real use.
5. Evidence of progress tied to capability rather than activity alone.
6. A premium, calm product experience.

Every acquisition page should prove some part of that system. The public method and product should reinforce each other.

### Query portfolio

Until GlideLingo has first-party Search Console data and access to a reliable keyword dataset, query priority is a
hypothesis based on product fit and visible search competition, not claimed search volume. Re-score the portfolio using
impressions, click-through rate, conversion, competitive difficulty, and product readiness after launch.

#### Tier 1: category-defining commercial queries

These are the largest strategic targets and the hardest to win. They require strong product proof, external authority,
and supporting topic clusters.

| Query cluster | Intended page owner | Searcher need | Required proof |
| --- | --- | --- | --- |
| AI language learning app | \`/ai-language-tutor/\` | Find an AI-enabled product that teaches rather than merely chats | Working product demonstration, supported languages, method, limitations, pricing, and real learner evidence |
| Best AI language learning app | Independent editorial coverage plus a transparent comparison resource | Decide between products | Honest comparison methodology, repeatable tests, current product data, and third-party validation |
| AI language tutor | \`/ai-language-tutor/\` | Get personalized explanation, practice, and feedback | Clear tutor workflow, examples, safety limits, and immediate product access |
| Language-learning app for speaking | \`/speaking-practice/\` | Become able to respond in real conversations | Voice demo, scenario examples, feedback loop, progression, and reviewed claims |
| Language app with structured courses | \`/courses/\` | Avoid an unstructured chatbot experience | Public course model, sample curriculum, lesson flow, and connection to speaking and review |
| Best language-learning app | Homepage and third-party coverage | Choose a complete platform | Broad product maturity, reviews, language coverage, brand demand, and trusted independent mentions |

GlideLingo should not expect the broadest terms to move first. They are the result of accumulated authority, not the
starting point.

#### Tier 2: product-differentiating commercial queries

These are the first realistic category opportunities because they match GlideLingo's core product thesis more precisely.

| Query cluster | Intended page owner | Core angle |
| --- | --- | --- |
| AI speaking practice | \`/speaking-practice/\` | Guided output, correction, retry, and continued conversation |
| AI conversation practice for language learning | \`/speaking-practice/\` | Real multi-turn scenarios connected to course progress |
| Structured AI language course | \`/courses/\` | A full learning path rather than open-ended chat |
| AI language tutor with curriculum | \`/ai-language-tutor/\` | Tutor behavior grounded in a planned course |
| Language app that teaches conversation | \`/speaking-practice/\` | Conversation as a trained sequence, not a final bonus |
| Language-learning app with feedback | \`/method/\` | Evidence-based correction and targeted next steps |
| Language-learning app for adults | A dedicated audience page only when product evidence supports it | Premium, calm, practical learning without childish pressure |
| Desktop language-learning app | \`/download/\` | A first-class desktop learning workflow |

#### Tier 3: high-intent problem queries

These queries can create earlier wins and introduce GlideLingo before the searcher has chosen a product category.

| Problem cluster | Canonical resource |
| --- | --- |
| I understand a language but cannot speak it | A definitive guide linked to speaking practice |
| How to practice speaking a language alone | A practical guide with a usable exercise or demo |
| How to stop translating in your head | A method guide with retrieval and production exercises |
| How to stop freezing when speaking another language | A speaking-confidence guide with recovery practice |
| How to become conversational in another language | A realistic capability roadmap |
| How to remember vocabulary while speaking | A review and retrieval guide |
| How to build a language-learning routine | A repeatable weekly plan connected to the product |
| Why language apps do not make me fluent | A balanced explanation of product limitations and missing practice |
| How much speaking practice do I need | An evidence-backed planning guide that avoids false precision |
| How to measure language-learning progress | A capability-based framework tied to GlideLingo's method |

Each problem page must solve the problem without requiring a purchase. Its product CTA should be the natural next action,
not a substitute for the answer.

#### Tier 4: supported-language queries

Every released language can create a focused path into the broader platform:

- \`AI {language} tutor\`
- \`learn {language} online\`
- \`{language} course for beginners\`
- \`{language} speaking practice\`
- \`{language} pronunciation practice\`
- \`how to start speaking {language}\`
- \`best app to learn {language} for conversation\`
- \`{language} for travel\`
- \`{language} for heritage speakers\` when the course and review expertise support that audience

Only instantiate these pages for languages with real, reviewed content. Template reuse is allowed for structure and
components; page copy, examples, audio, reviewer evidence, and learning guidance must be language-specific.

### Competitive ladder

The ranking program advances through four stages.

#### Stage 1: eligibility

Goal: search and answer systems can reliably retrieve the right canonical pages.

Exit criteria:

- Priority pages return \`200\`, render useful static HTML, self-canonicalize, appear in the sitemap, and are linked.
- Google Search Console and Bing Webmaster Tools verify indexing.
- Desired search and answer crawlers reach production without CDN or WAF denial.
- Structured data validates and matches visible content.
- Conversion and referral events are measurable.

#### Stage 2: relevance

Goal: GlideLingo has the clearest page for each chosen intent.

Exit criteria:

- One canonical page owns each query cluster.
- Titles, headings, introductions, examples, and internal links clearly establish the subject.
- Supporting pages form coherent clusters around courses, speaking, feedback, review, progress, and supported languages.
- Search impressions begin appearing for non-brand queries.
- Pages do not cannibalize one another for the same intent.

#### Stage 3: superiority

Goal: priority pages are materially more useful than the current leading results.

Before publishing, compare the page with the leading results for the target query. It must exceed them in at least two
defensible dimensions:

- First-party product proof.
- Original data or repeatable testing.
- Expert or native-speaker review.
- Practical utility or an interactive tool.
- Depth and clarity of explanation.
- Better examples, audio, transcripts, or visual demonstrations.
- More accurate and transparent comparison.
- More current product information.
- Stronger connection between advice and an actionable learning system.

If the proposed page merely summarizes what the existing results already say, do not publish it.

#### Stage 4: authority

Goal: independent sources validate GlideLingo as a credible answer.

Exit criteria:

- Qualified teachers, creators, reviewers, communities, or publications mention and link to useful GlideLingo resources.
- Branded search demand grows.
- Independent comparisons include GlideLingo based on real access and testing.
- First-party research or public tools earn legitimate citations.
- GlideLingo begins appearing as a linked source across a fixed set of relevant AI questions.
- Qualified organic and AI-referred traffic converts into course starts and subscriptions.

### Page-winning formula

Each strategic page should be built as a complete answer and product proof surface.

1. **Answer:** Give the direct answer or value proposition immediately.
2. **Demonstrate:** Let the visitor see, hear, or try the relevant experience.
3. **Explain:** Show how the method works and why each step exists.
4. **Prove:** Add first-party evidence, reviewed examples, transparent testing, or credible sources.
5. **Compare:** Explain where the approach is stronger, weaker, or different without misleading claims.
6. **Resolve objections:** Address price, language availability, level, device support, privacy, limitations, and human
   teacher compatibility when relevant.
7. **Connect:** Link to the parent hub and adjacent supporting resources.
8. **Convert:** Offer a CTA that matches the visitor's intent and the product's real release state.
9. **Maintain:** Display accurate dates and update the page when the product or evidence changes.

### Citation-worthy assets

Articles alone will not create a durable advantage. GlideLingo should build assets that other pages and answer systems
have a reason to reference.

Priority assets:

1. **The GlideLingo learning method:** Publish the full Course → Mission → Lesson → Experience → Evidence → Review model
   and the Encounter → Notice → Retrieve → Produce → Perform → Revisit learning cycle with concrete examples.
2. **A public speaking demo:** Let a visitor experience a short representative conversation or watch a precise,
   transcript-supported first-party demonstration without creating an account.
3. **Conversation readiness framework:** Define observable capabilities for beginning, responding, recovering, and
   continuing rather than publishing an unsupported numeric fluency score.
4. **Language-specific pronunciation libraries:** Use reviewed audio, stress, transliteration where useful, common errors,
   and practical examples.
5. **Original learner insight reports:** Publish only sufficiently aggregated, privacy-reviewed findings, such as common
   speaking breakdowns or which forms of review lead to successful later retrieval.
6. **Transparent product evaluations:** Compare structured lessons, conversation quality, correction quality, review,
   progress evidence, language coverage, and cost using a repeatable methodology. Disclose GlideLingo's authorship and
   never disguise marketing as independent research.
7. **Reusable practice resources:** Scenario checklists, recovery phrase guides, weekly plans, and printable or
   interactive exercises that remain useful outside the product.

### Authority and distribution plan

Ranking number one for valuable commercial queries requires trusted references beyond glidelingo.com.

#### Expert network

- Recruit qualified language educators and native-speaker reviewers for supported-language clusters.
- Publish real reviewer biographies, scope, and review dates.
- Invite experts to contribute examples or explanations with editorial control and attribution.
- Build relationships with cultural organizations, language departments, tutors, and heritage communities.

#### Creator and affiliate network

- Give relevant language and travel creators real product access.
- Encourage honest demonstrations and reviews rather than scripted praise.
- Provide deep links to the most relevant language or speaking page.
- Disclose affiliate relationships.
- Track which external placements produce course starts and retained subscribers, not only clicks.

#### Editorial and digital public relations

- Pitch original findings, public tools, meaningful product releases, and learner resources.
- Target language-learning publications, education technology coverage, travel media, diaspora publications, newsletters,
  podcasts, and app reviewers.
- Maintain a current public press and product-facts page so third parties cite accurate claims.
- Do not purchase links or publish fake "independent" rankings.

#### Community participation

- Participate where learners already discuss real problems.
- Answer the question fully before mentioning the product.
- Do not automate promotional replies or manufacture community consensus.
- Use recurring questions and objections as research for stronger first-party pages.

### Twelve-week launch sequence

The sequence assumes the product and claims exposed by each page are real. Defer any page whose required proof is not
ready.

#### Weeks 1–2: make the site eligible and measurable

- Complete the P0 technical foundation.
- Verify Google and Bing properties and submit the sitemap.
- Resolve production crawl, canonical, redirect, schema, and measurement issues.
- Define the first 40-query search and AI prompt benchmark.
- Record the initial indexation, ranking, citation, and conversion baseline.

#### Weeks 3–4: establish category ownership

Publish or materially rebuild:

- Homepage.
- \`/method/\`.
- \`/courses/\`.
- \`/speaking-practice/\`.
- \`/ai-language-tutor/\`.
- \`/languages/\`.
- \`/pricing/\`.
- \`/download/\`.
- \`/about/\`.

The homepage remains multi-language. Each supporting page owns one specific product job and links to the others through a
clear hub structure.

#### Weeks 5–8: win differentiated and problem intent

- Publish the first six to eight Tier 2 and Tier 3 resources.
- Replace generic claims with reviewed examples, demos, and product evidence.
- Add the first complete supported-language hub and only the spokes supported by real material.
- Begin expert, creator, and editorial outreach around the strongest public resource.
- Refresh pages based on actual queries and visitor behavior rather than adding volume blindly.

#### Weeks 9–12: create authority

- Release one citation-worthy first-party asset or transparent report.
- Secure legitimate expert contributions and product evaluations.
- Expand the first supported-language cluster based on measured demand.
- Update comparison and product pages with verified evidence.
- Review the 40-query benchmark across Google, Bing/Copilot, ChatGPT, and Perplexity.
- Decide the next cluster using conversion opportunity, evidence readiness, and competitive gaps.

### Publishing cadence

The default ceiling during the first twelve weeks is:

- One strategic commercial or product page when the product proof is ready.
- One or two substantial supporting resources per week.
- One meaningful refresh or evidence upgrade per week.
- Ongoing distribution for existing assets.

This is not a quota. Publish nothing when the proposed work does not improve the best available answer.

### Search and AI benchmark

Maintain a versioned benchmark of at least 40 questions divided across:

- Broad category discovery.
- Speaking and conversation practice.
- Structured-course discovery.
- Problem and pain-point questions.
- Supported-language discovery.
- Comparisons.
- Brand and product verification.

For each query and answer system, record:

- Whether GlideLingo appears.
- Linked citation versus unlinked mention.
- Position or prominence.
- Which GlideLingo URL appears.
- Which competitors appear.
- Which sources support those competitors.
- Whether the answer accurately describes GlideLingo.
- Landing-page conversion from measurable referrals.

Run the benchmark from a consistent environment. AI responses vary, so use repeated observations and trends rather than
treating one answer as a stable ranking.

### Decision score for new pages

Before authorizing a strategic page, score each dimension from 0–3:

| Dimension | Question |
| --- | --- |
| Product fit | Does GlideLingo solve this exact need today? |
| Commercial value | Is the searcher plausibly choosing or using a language-learning product? |
| Evidence readiness | Can the page demonstrate or substantiate its claims? |
| Differentiation | Can GlideLingo provide something leading pages do not? |
| Authority potential | Would a credible third party have a reason to cite this page? |
| Cluster support | Does the page strengthen an existing hub rather than create an isolated topic? |
| Maintainability | Can the information remain accurate as the product changes? |

Prioritize pages with the strongest combined score. A high estimated search volume cannot compensate for weak product fit
or absent evidence.

### Number-one scorecard

The program is moving toward number-one visibility when:

- Priority URLs are indexed and receiving non-brand impressions.
- GlideLingo owns top positions for narrow Tier 3 or Tier 4 queries.
- Those wins expand into Tier 2 commercial clusters.
- External sites cite the method, tools, examples, or research.
- AI systems cite GlideLingo for relevant questions without being prompted with the brand name.
- Organic and AI traffic produces course starts, repeat learning activity, and paid conversion.
- Branded search demand and direct mentions grow.
- Broader Tier 1 rankings improve after authority is established.

The goal is not to report a vanity ranking while the page produces no learners. The business outcome is qualified
discovery that turns into speaking practice, course progression, retention, and revenue.


## Implementation plan

### P0: discovery and measurement foundation

- Verify Google Search Console and Bing Webmaster Tools.
- Submit the production sitemap.
- Confirm production HTTP responses, canonical host redirects, and crawler access.
- Confirm OAI-SearchBot and other desired search crawlers are not blocked by Cloudflare.
- Add Organization, WebSite, SoftwareApplication, BlogPosting, BreadcrumbList, and eligible VideoObject JSON-LD.
- Add authorship, review, published, and modified data to the editorial content schema.
- Add breadcrumbs and contextual related-content links.
- Implement privacy-appropriate conversion and referral measurement.
- Add build checks for canonical, metadata, schema presence, sitemap inclusion, and accidental noindex.

### P1: multi-language acquisition architecture

- Publish \`/languages/\`.
- Publish the first truthful language hub for the released or preview course.
- Publish \`/method/\`, \`/speaking-practice/\`, \`/ai-language-tutor/\`, \`/pricing/\`, and \`/download/\`.
- Update homepage copy and metadata to communicate the complete multi-language product.
- Add stable product and language navigation.
- Create reusable page data models rather than copying entire pages.

### P2: topical authority

- Build a reviewed content cluster around each supported language.
- Add original exercises, native audio, transcripts, and practical examples.
- Add expert review and corrections workflow.
- Build useful interactive public tools only when they create real learner value.
- Earn relevant references through partnerships, resources, and first-party findings.
- Add localized marketing pages only when the complete locale experience can be maintained.

## Page release checklist

Before merging any indexable page, confirm:

### Intent and truth

- [ ] One primary user question or search intent is explicit.
- [ ] The page accurately reflects current product availability.
- [ ] The company remains positioned as a multi-language platform.
- [ ] AI claims identify a real feature and learner benefit.
- [ ] No unsupported outcome, comparison, rating, or expertise claim exists.

### Content

- [ ] The opening answers the user's question.
- [ ] The page contains first-party or expert-reviewed value.
- [ ] Language examples are accurate and reviewed where applicable.
- [ ] Claims that need support have accessible sources.
- [ ] Author, reviewer, published date, and updated date are correct.
- [ ] The CTA matches the page's intent and release state.

### Discovery

- [ ] The URL is canonical, stable, and linked internally.
- [ ] The page returns \`200\` and is not blocked or noindexed.
- [ ] The canonical is absolute and self-referencing.
- [ ] The sitemap contains the canonical URL.
- [ ] Breadcrumbs and related pages use crawlable links.
- [ ] Robots, CDN, and WAF permit desired crawlers.

### Presentation

- [ ] Title, description, \`h1\`, and visible copy agree.
- [ ] Social metadata and image are unique and accurate.
- [ ] Structured data matches visible content and validates.
- [ ] Images have dimensions and useful alt text.
- [ ] Video has captions and supporting text where relevant.
- [ ] Mobile, keyboard, reduced-motion, and accessibility behavior pass.

### Measurement and verification

- [ ] The intended conversion event is measurable.
- [ ] Analytics requests comply with CSP and privacy decisions.
- [ ] Automated website checks pass.
- [ ] The built page is manually inspected.
- [ ] Search Console inspection is requested for a strategically important new or corrected URL after production deploy.

## Maintenance cadence

- Review Search Console and Bing indexing issues weekly during launch.
- Review search queries, landing-page conversion, and content decay monthly.
- Revalidate structured data after template changes.
- Review crawler policy and official provider documentation quarterly.
- Review this document immediately after a material Google, OpenAI, Bing, Perplexity, or Anthropic policy change.
- Update the "Last reviewed" date only after checking the official sources.

## Official source register

Google:

- [Google Search documentation](https://developers.google.com/search/docs)
- [Google Search Essentials](https://developers.google.com/search/docs/essentials)
- [How Google Search works](https://developers.google.com/search/docs/fundamentals/how-search-works)
- [Google Search ranking systems](https://developers.google.com/search/docs/appearance/ranking-systems-guide)
- [AI features and your website](https://developers.google.com/search/docs/appearance/ai-features)
- [Optimizing for generative AI features](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide)
- [Creating helpful, reliable, people-first content](https://developers.google.com/search/docs/fundamentals/creating-helpful-content)
- [Guidance for generative AI content](https://developers.google.com/search/docs/fundamentals/using-gen-ai-content)
- [Google spam policies](https://developers.google.com/search/docs/essentials/spam-policies)
- [Google Search appearance and structured data](https://developers.google.com/search/docs/appearance)

OpenAI:

- [Official OpenAI crawler documentation](https://developers.openai.com/api/docs/bots)

Microsoft:

- [Bing Webmaster Guidelines](https://www.bing.com/webmasters/help/webmaster-guidelines-30fba23a)
- [Bing Webmaster Tools](https://www.bing.com/webmasters/)

Perplexity:

- [Perplexity crawler documentation](https://docs.perplexity.ai/docs/resources/perplexity-crawlers)

Anthropic:

- [Anthropic crawler guidance](https://support.anthropic.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler)

These official sources take precedence over third-party checklists, SEO scores, social posts, and this document when a
conflict exists.
