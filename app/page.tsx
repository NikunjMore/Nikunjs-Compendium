/* One static page. No JavaScript needed to read any of it. */

const WORK = [
  {
    name: 'Adiom',
    role: 'Product Management Intern',
    line: 'Redesigned the website conversion flow and tripled qualified sales conversations. Built an outreach workflow that narrowed 1,000+ prospects to the 20 best.',
  },
  {
    name: 'PeerPrep',
    role: 'Co-founder',
    line: 'Grew a tutoring nonprofit from 0 to 175+ families in 18 months. Built an AI workflow that turns session notes into parent updates, lifting satisfaction 12 points.',
  },
  {
    name: 'Three Big Trees',
    role: 'My family business',
    line: 'Built an AI order system that turns WhatsApp orders into quotes. Order lead time went from 4 days to 1.',
  },
  {
    name: 'De Anza Student Government',
    role: 'Budget Analyst',
    line: 'Managed funding requests across a $1M+ budget and won $160K a year in recurring funding from the Board of Trustees.',
  },
];

const PROJECTS = [
  {
    name: 'The Insight Company of California',
    line: 'Private speech apps that run on your own computer: dictation, text-to-speech and meeting notes at 98%+ accuracy. Your voice never trains anyone else’s model.',
  },
  {
    name: 'Latent-space world models',
    line: 'Research on Meta’s V-JEPA that forecasts a robotic arm’s movements from actuator data. Recognized by Meta AI.',
  },
];

export default function Page() {
  return (
    <main>
      <header>
        <img src="/me.jpg" alt="Nikunj More" width={72} height={72} className="me" />
        <h1>Nikunj More</h1>
        <p className="lede">
          UC Berkeley, Haas + Stats, minor in EECS, class of 2028. I build AI products and
          I&apos;m looking for a Summer 2027 product management internship.
        </p>
      </header>

      <section>
        <h2>Experience</h2>
        <ul>
          {WORK.map((w) => (
            <li key={w.name}>
              <p className="item">
                <strong>{w.name}</strong> <span className="dim">{w.role}</span>
              </p>
              <p>{w.line}</p>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Projects</h2>
        <ul>
          {PROJECTS.map((p) => (
            <li key={p.name}>
              <p className="item"><strong>{p.name}</strong></p>
              <p>{p.line}</p>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Contact</h2>
        <p>
          <a href="mailto:nikunj.more@berkeley.edu">nikunj.more@berkeley.edu</a>
          {' · '}
          <a href="https://www.linkedin.com/in/nikunj-more/">LinkedIn</a>
          {' · '}
          <a href="tel:+16508809285">(650) 880-9285</a>
        </p>
        <p className="dim">Bay Area. Off the clock: bouldering, pickleball and Coke Zero.</p>
      </section>
    </main>
  );
}
