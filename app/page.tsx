import Corridor from './corridor';
import Reveal from './reveal';

/* Letters are split so each one can hop on hover. */
function Word({ text }: { text: string }) {
  return (
    <span className="word" aria-label={text}>
      {[...text].map((ch, i) => (
        <span key={i} className="ltr" aria-hidden="true">{ch}</span>
      ))}
    </span>
  );
}

function Tab({ n, label }: { n: string; label: string }) {
  return (
    <div className="tab" data-reveal>
      <span>{n}</span>
      <span>{label}</span>
      <span>/03</span>
    </div>
  );
}

/* Count-up target: shows the final value without JavaScript. */
function N({ to, pre = '', post = '' }: { to: number; pre?: string; post?: string }) {
  return <span data-to={to} data-pre={pre} data-post={post}>{pre}{to}{post}</span>;
}

function Stat({ num, what, where, wide }: { num: React.ReactNode; what: string; where: string; wide?: boolean }) {
  return (
    <div className={`cell stat${wide ? ' wide' : ''}`} data-reveal>
      <p className="num">{num}</p>
      <p className="what">{what}</p>
      <p className="where">{where}</p>
    </div>
  );
}

export default function Page() {
  return (
    <>
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
        <div className="strip band">
          <span>Builds AI products</span>
          <span className="ticks" aria-hidden="true" />
          <span>Open to Summer 2027 PM internships</span>
        </div>
      </header>

      <section className="room" id="room" aria-label="About Nikunj">
        <Corridor />
        <div className="col" id="col">
          <Tab n="01" label="About" />
          <div className="cell about">
            <img src="/me.jpg" alt="Nikunj More" width={112} height={140} />
            <div className="prose">
              <p>
                I&apos;m building The Insight Company of California, a set of private speech apps
                that run on your own computer, so your voice never trains someone else&apos;s model.
              </p>
              <p>
                I want to work as an AI product manager: deciding what gets built, why, and how
                it reaches people. On the research side, I used{' '}
                <a href="https://ai.meta.com/blog/v-jepa-yann-lecun-ai-model-video-joint-embedding-predictive-architecture/">Meta&apos;s V-JEPA</a>{' '}
                to forecast a robotic arm&apos;s movements, and Meta AI recognized the work.
              </p>
              <p>
                After high school, I spent two years at{' '}
                <a href="https://www.deanza.edu/">De Anza College</a> and finished five associate
                degrees. Now I study business and statistics at{' '}
                <a href="https://haas.berkeley.edu/">UC Berkeley</a>, with a minor in EECS. Along
                the way, I was a PM intern at <a href="https://adiom.io/">Adiom</a>, ran operations
                for my family&apos;s business, managed budgets for{' '}
                <a href="https://www.deanza.edu/dasg/">De Anza&apos;s student government</a>, and
                co-founded PeerPrep, a tutoring group.
              </p>
              <p>
                In my free time, I go bouldering, play pickleball, and start random projects with
                friends, usually with a Coke Zero in hand.
              </p>
            </div>
          </div>

          <Tab n="02" label="Proof" />
          <div className="grid">
            <Stat wide num={<N to={3} post={'×'} />} what="qualified sales conversations" where="Adiom" />
            <Stat num={<N to={175} post="+" />} what="families served" where="PeerPrep" />
            <Stat num={'4→1'} what="days to fill an order" where="Family business" />
            <div className="cell hatch" aria-hidden="true" data-reveal />
            <Stat num={<N to={160} pre="$" post="K" />} what="a year in new funding" where="De Anza student government" />
          </div>

          <Tab n="03" label="Contact" />
          <div className="cell contact" id="contact" data-reveal>
            <a href="mailto:nikunj.more@berkeley.edu">
              <span>nikunj.more@berkeley.edu</span><i aria-hidden="true">&#8599;</i>
            </a>
            <a href="https://www.linkedin.com/in/nikunj-more/">
              <span>LinkedIn</span><i aria-hidden="true">&#8599;</i>
            </a>
            <a href="tel:+16508809285">
              <span>(650) 880-9285</span><i aria-hidden="true">&#8599;</i>
            </a>
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
