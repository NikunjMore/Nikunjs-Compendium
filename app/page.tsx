import Corridor from './corridor';
import Fizz from './fizz';
import Reveal from './reveal';

/* Letters are split so each one can hop on hover. */
function Word({ text }: { text: string }) {
  return (
    <span className="word" aria-label={text}>
      {[...text].map((ch, i) => (
        <span key={i} className="ltr" aria-hidden="true" style={{ ['--i' as string]: i }}>
          {ch}
        </span>
      ))}
    </span>
  );
}

function Tab({ n, label }: { n: string; label: string }) {
  return (
    <div className="tab" data-reveal>
      <span>{n}</span>
      <span>{label}</span>
      <span>/04</span>
    </div>
  );
}

type Stat = {
  to?: number; pre?: string; post?: string; shown: string;
  what: string; where: string; wide?: boolean;
};

const STATS: Stat[] = [
  {
    to: 3, post: '×', shown: '3×', wide: true,
    what: 'qualified sales conversations',
    where: 'Adiom, PM intern. Redesigned the conversion flow and A/B tested it.',
  },
  {
    to: 175, post: '+', shown: '175+',
    what: 'families served',
    where: 'PeerPrep, co-founder. From zero in 18 months.',
  },
  {
    shown: '4→1',
    what: 'days to fill an order',
    where: 'My family business. AI order system built on WhatsApp.',
  },
  {
    to: 160, pre: '$', post: 'K', shown: '$160K',
    what: 'a year in new funding',
    where: 'De Anza Student Government, budget analyst.',
  },
];

export default function Page() {
  return (
    <>
      <Fizz />
      <Reveal />

      <header className="top">
        <div className="strip">
          <span>Berkeley Haas + Stats &apos;28</span>
          <span className="ticks" aria-hidden="true" />
          <span>Bay Area, CA</span>
        </div>
        <h1 className="name">
          <Word text="Nikunj" />
          <span className="dot" aria-hidden="true" />
          <Word text="More" />
        </h1>
        <div className="strip">
          <span>Builds AI products</span>
          <span className="ticks" aria-hidden="true" />
          <span>Open to Summer 2027 PM internships</span>
        </div>
      </header>

      <section className="room" id="room" aria-label="About Nikunj">
        <Corridor />
        <div className="col" id="col">
          <Tab n="01" label="About" />
          <div className="cell about" data-reveal>
            <img src="/me.jpg" alt="Nikunj More" width={112} height={140} />
            <div>
              <p className="lead">
                I like building things, especially with ambitious people. Lately that means AI
                product management: figuring out what should get built, why, and how to get it
                into people&apos;s hands.
              </p>
              <p className="sub">
                Business Administration and Statistics at UC Berkeley, minor in EECS.
              </p>
            </div>
          </div>

          <Tab n="02" label="Proof" />
          <div className="grid">
            {STATS.slice(0, 3).map((s) => <StatCell key={s.shown} s={s} />)}
            <div className="cell hatch" aria-hidden="true" data-reveal />
            <StatCell s={STATS[3]} />
          </div>

          <Tab n="03" label="Building" />
          <div className="cell build" data-reveal>
            <p className="meta">Now &middot; Python, Go, Node.js</p>
            <h3>The Insight Company of California</h3>
            <p>
              Private speech apps that run on your own computer: dictation, text-to-speech and
              meeting notes at 98%+ accuracy. Your voice never trains anyone else&apos;s model.
            </p>
          </div>
          <div className="cell build" data-reveal>
            <p className="meta">Research &middot; PyTorch</p>
            <h3>Latent-space world models</h3>
            <p>
              Built on Meta&apos;s V-JEPA. It forecasts a robotic arm&apos;s movements from
              actuator data, and the work was recognized by Meta AI.
            </p>
          </div>

          <Tab n="04" label="Contact" />
          <div className="cell contact" data-reveal>
            <a href="mailto:nikunj.more@berkeley.edu">
              <span>nikunj.more@berkeley.edu</span><i aria-hidden="true">&#8599;</i>
            </a>
            <a href="https://www.linkedin.com/in/nikunj-more/">
              <span>LinkedIn</span><i aria-hidden="true">&#8599;</i>
            </a>
            <a href="tel:+16508809285">
              <span>(650) 880-9285</span><i aria-hidden="true">&#8599;</i>
            </a>
            <p className="meta">
              Off the clock: bouldering, pickleball and Coke Zero. The bubbles are the Coke Zero.
            </p>
          </div>
        </div>
      </section>

      <footer className="foot">
        <span>&copy; 2026 Nikunj More</span>
        <span>Set in Geist</span>
      </footer>
    </>
  );
}

function StatCell({ s }: { s: Stat }) {
  return (
    <div className={`cell stat${s.wide ? ' wide' : ''}`} data-reveal>
      <p className="num">
        {s.to !== undefined ? (
          <span data-to={s.to} data-pre={s.pre ?? ''} data-post={s.post ?? ''}>{s.shown}</span>
        ) : (
          s.shown
        )}
      </p>
      <p className="what">{s.what}</p>
      <p className="where">{s.where}</p>
    </div>
  );
}
