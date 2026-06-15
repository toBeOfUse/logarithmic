// A complete "messy first draft" used as the markdown round-trip integration
// fixture. It deliberately leans on every construct at once: H2/H3 headings, a
// struck-through heading, strikethrough spanning links, an inline comment and a
// standalone comment block, escaped brackets, a footnote with a rich body, and
// multi-paragraph blockquotes. Kept as a string (not a `.md` file) so the prose
// is not reflowed by the formatter, which would fight the serializer on the
// emphasis delimiter (`*` vs `_`).
//
// Backslashes are doubled here so the runtime string holds a single `\` before
// the escaped brackets — i.e. `\[` reaches the markdown parser as an escape.
export const essay = `## Messy first draft!

Music is a very old form of self-expression. Two thousand years ago, a man named Seikilos engraved the oldest surviving complete musical composition onto a stele, writing on it "I am an image and a stone; Seikilos sets me up here/As a long-lasting marker of undying memory." In 1977, Fleetwood Mac released Rumours, an album whose power famously comes from Stevie Nicks and Lindsey Buckingham, and Christine and John McVie, singing about each other, with each other, from within the wreckage of their relationships and marriages to each other. (And Mick Fleetwood was there too.) And as I write this, Ariana Grande is at the top of the Billboard Hot 100 with "Hate That I Made You Love Me." Mac Miller's early death, the exes she lists on "Thank U, Next," and her tumultuous relationship with her own fans and the guy who played SpongeBob in the SpongeBob musical are obviously a huge part of what makes Ari's music meaningful to so many people.

<!-- Something something mention later how I feel the need to specify that these references are actually coming from my own brain and are part of me right now. Might get relegated to a footnote -->

~~So what would it mean to "ruin music" as a form of self-expression? There's a guy out there who's worried he's doing just that: Paul Sinclair, who works for Suno, a company that creates music on demand using generative AI.~~ [~~"Every day I wake up and I'm like, 'Don't ruin music,' he says with a laugh."~~](https://www.billboard.com/pro/suno-ai-music-startup-cover-story/) ~~So let's check in on how he's doing.~~

## ~~How to Ruin Music~~

Suno is a multifaceted platform that hosts... \\[overview of what Suno does]

I have my own instinctive reaction to "AI music," just, like, as a concept. It's a reaction that feels completely natural and obvious to me, but there's a large chunk of humanity, [judging by the Suno music subreddit](https://archive.is/cTtsW) and numerous sightings and encounters with the subculture colloquially known as "tech bros," that apparently has the exact opposite reaction. This essay isn't really about me; it's more about them. But lets dwell on the weirdness for a second.

In the past, when you heard a voice on the radio, you could assume that at some point, someone actually leaned into a microphone and physically produced those sounds. Yeah, I know, comped vocals are a thing, and so is Hatsune Miku, but usually you could tell whether there was an original vocal track that a singer produced or not. This did two things: it created a connection between you, the sound you were hearing, and the person who initially produced it; and it kept those sounds rare and striking.

## The Industrialist Mindset

Nilay Patel, the editor-in-chief of the technology and culture site The Verge, has this concept he calls [software brain](https://www.theverge.com/podcast/software-brain-ai-backlash-databases-automation/software-brain-ai-backlash-databases-automation), which he says is "when you see the whole world as a series of databases that can be controlled with the structured language of software code."[^1]

I think this is a great description of traditional failure modes of the tech industry and Web 2.0, but I would take it one step further. I would like to coin the term "industrialist brain," which is when you see all human activity as part of a system of standardizable, repeatable, controllable processes that can be replicated with or without the participation of any specific humans.

Obviously, this is not a new thing. As John Gall puts it in the great book Systemantics:

> There is a man in our neighborhood who is building a boat in his back yard. He knows very little of boat-building and still less of sailing or navigation. He works from plans drawn up by himself. Nevertheless, he is demonstrably building a boat and can be called, in some real sense, a boat-builder.
>
> Now if you go down to Hampton Roads or any other great shipyard and look around for a ship-builder, you will be disappointed. You will find in abundance welders, carpenters, foremen, engineers, and many other specialists, but no ship-builders. In cold fact, a system is building ships, and the system is the shipbuilder.

The weirdness of the current moment, to me, is the application of the ideals of automation to the process of creativity, and the goals of abundant production to the hallmarks of individual involvement.

### Aside: Are Robots People?

One of the most disorienting parts of the current AI moment is the realization that intelligence, for some weirdly-shaped but very relevant definition of intelligence, does not need to be tied to an individual ego or consciousness. ChatGPT does not work the same way; it doesn't have memory apart from the text you've typed and it's generated. \\[Even if you blew up the server after every word ChatGPT generated and built a new one...] This is just weird, and makes it even harder to view the things that generative AI can produce as valuable.

## Going to Seed

Adam Mastroianni, author of the great Substack [Experimental History](https://www.experimental-history.com/), put it very clearly [when he said](https://www.experimental-history.com/p/infinite-midwit) that the idea of computers doing his writing instead of him made him want to "fill \\[his] pockets with stones and wade into the sea." I understand that reaction.

To me, the overwhelming message of the AI era is "You Don't Matter." I'm being told that something else will read my texts for me, give advice instead of me, do research and better than me, and generally take over the things that I did that were valuable.

[^1]: This might be an older mindset than Nilay realizes. The parallels to High Modernism and *Seeing Like A State* are left as an exercise to the reader.`;
