# Roadmap

What to build next and why, in plain language. The goal is to turn LectureLens
from a working project into something a real student could use every day.

Each item says what it is, why it matters, how you know it worked, and roughly
how long it takes. Items are ordered by value for the effort. Nothing here is
started yet.

## Where the project stands today

It answers questions about one Udemy course, cites the module, lesson, and
timestamp, refuses questions outside the course, and handles follow-up
questions. Retrieval is measured with 55 hand-labeled questions, and the
numbers can be reproduced offline from a committed cache.

What it is not yet: something another person can point at their own course
and use without you.

## Phase 1: make it trustworthy to demo

### 1. Measure speed and cost per stage

**What.** Time each step (guardrail, condensation, HyDE, search, rerank,
answer) and count the tokens each one spends. Print a table like the retrieval
one.

**Why.** Right now you can say the bot finds the right lesson 71% of the time,
but not how long a student waits or what a question costs. Those are the first
two questions anyone asks about a real product, and the answer decides which
stages are worth keeping. If rerank adds three seconds for two points of
accuracy, that is a real tradeoff worth showing.

**Done when.** The README has a table of median and slowest time per stage, and
an estimated cost per question.

**Effort.** Half a day to a day.

### 2. Stream the answer as it is written

**What.** Send the answer to the browser word by word instead of waiting for
the whole thing.

**Why.** The wait is the worst part of using the bot. Streaming does not make
it faster, it makes it feel faster, because reading starts immediately. Every
chat product does this, and its absence is the first thing people notice.

**Done when.** Text appears within about a second of asking, and citations
still render correctly once the answer finishes.

**Effort.** A day.

### 3. Make citations clickable

**What.** Turn "Module 8, Getting Started with Expo Camera, 08:16" into a link
that jumps to that moment of the video.

**Why.** This is the whole point of the product. A timestamp you have to copy
by hand is a lookup; a timestamp you can click is a shortcut. It is also the
single most impressive thing to show in a demo, because the payoff is visible
in one click.

**Done when.** Clicking a citation opens the lesson at the right second.

**Effort.** A day, plus whatever it takes to map lessons to video URLs.

## Phase 2: make it usable by someone who is not you

### 4. Let a user add their own course

**What.** A page to upload subtitle files, which then get chunked, embedded,
and indexed, with progress shown.

**Why.** Today adding a course means running a script on your laptop. Until
someone else can add their own material, this is a demo of one course rather
than a tool. This is the single biggest step from project to product.

**Why it is harder than it looks.** Two users must not see each other's
content, so every chunk needs an owner and every search must filter by it.

**Done when.** A new person can sign up, upload a course, and ask a question
about it without you touching anything.

**Effort.** A week, and it changes the shape of the system.

### 5. Accounts and per-user limits

**What.** Log in, keep your own chat history, and cap how many questions each
account can ask per day.

**Why.** Two reasons. Chat history makes it feel like a product you return to
rather than a page you try once. Limits protect your free-tier keys: without
them, one person can spend your entire daily quota in a few minutes.

**Done when.** Two accounts see different histories and different courses, and
hitting the cap gives a clear message instead of an error.

**Effort.** Two to three days.

### 6. A feedback button on every answer

**What.** Thumbs up and down, with the question, the retrieved excerpts, and
the answer saved.

**Why.** Your 55 labeled questions were written by you, so they reflect what
you thought to ask. Real users ask things you did not imagine. Thumbs down is
free labeled data and points straight at what to fix. Good answers with a
thumbs up become new eval cases.

**Done when.** Rated answers are stored and you can list the worst ones in one
command.

**Effort.** A day.

## Phase 3: make the quality defensible

### 7. Judge answer quality, not just retrieval

**What.** For each answer, ask a second model whether every claim is supported
by the excerpts the bot retrieved, and report the share that are grounded.

**Why.** The eval measures whether the right transcript was found and whether
citations point at real excerpts. It does not check whether the answer
actually follows from them. The one bad answer you found by hand, joining a
remark about development builds to code from a different module, is exactly
what this catches, and reading every answer by hand does not scale.

**Watch out.** A model judging a model is not proof. Grade a sample by hand
first, and report how often the judge agrees with you.

**Done when.** The README reports a groundedness score plus how well the judge
matches human grading.

**Effort.** Two to three days, and it costs quota.

### 8. Try different chunk sizes

**What.** Re-index at a few chunk lengths, for example 30, 45 and 90 seconds,
and rerun the eval on each.

**Why.** Chunk size was picked once at about 45 seconds and never questioned,
yet it decides what a single search result can contain. Short chunks are
precise but cut explanations in half; long chunks keep context but dilute the
match. This is a cheap experiment that may move the numbers more than any
clever prompt.

**Done when.** A table shows retrieval quality at each size and the README says
which size is used and why.

**Effort.** A day of work, plus indexing and eval time.

### 9. Run the eval automatically on every change

**What.** A GitHub Action that runs the tests and the cache-only eval on each
pull request, failing if a published number changes without the results file
changing with it.

**Why.** The numbers in the README are the most valuable thing in the repo and
the easiest to break by accident. Checking automatically means you never quote
a stale figure in an interview.

**Done when.** A pull request that changes retrieval shows the eval failing.

**Effort.** Half a day.

## Phase 4: nice to have, once the rest exists

- **Search across several courses at once**, which finally makes query routing
  meaningful rather than something the README explains away.
- **Suggested follow-up questions** under each answer, so a student can explore
  without knowing what to ask.
- **A weak-spot report** built from questions the bot answered badly, which
  tells a course creator which lessons confuse people.
- **Cache repeated questions** so common ones are free and instant.

## Two things worth saying honestly

**The eval is small.** 38 single-turn questions means one question moves the
score about 3 points. Growing the question set, especially with questions from
real users, is worth more than another round of tuning.

**A demo beats a description.** A 60 second recording of asking a question,
getting an answer, and clicking a citation to land on the exact moment of the
video is worth more than any table on a resume. Record it once items 2 and 3
are done.
