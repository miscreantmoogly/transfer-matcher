// /design-system: every component and every variant on one page.
//
// Ambrook uses Storybook for this. This page does the same job without adding
// Storybook to the demo: when a component changes, look here to see every
// state it can be in.

import type { Metadata } from "next";
import { MATCH_KINDS, MATCH_TIERS, PROPOSAL_STATUSES } from "@/lib/domain";
import {
  AmButton,
  AmCheckList,
  AmKindPill,
  AmMoney,
  AmPill,
  AmStatusPill,
  AmTierPill,
  Colors,
  Theme,
} from "@/design-system";
import styles from "./gallery.module.css";

export const metadata: Metadata = { title: "Design system · Transfer Matcher" };

function Example({ name, code, children, dark = false }: { name: string; code: string; children: React.ReactNode; dark?: boolean }) {
  return (
    <div className={styles.example}>
      <div className={`${styles.stage} ${dark ? styles.dark : ""}`}>{children}</div>
      <div className={styles.caption}>
        <span>{name}</span>
        <code>{code}</code>
      </div>
    </div>
  );
}

export default function DesignSystemPage() {
  return (
    <main className={styles.page}>
      <header className={styles.head}>
        <a href="/" className={styles.back}>
          ← Back to the app
        </a>
        <h1>Design system</h1>
        <p>
          Every <code>Am</code> component and variant. Logic lives in each <code>.tsx</code> file, presentation in the
          <code>.module.css</code> beside it, and colors come from one module, <code>design-system/colors.ts</code>. Components that show backend values
          take their types from <code>lib/domain.ts</code>, the same lists the database checks.
        </p>
      </header>

      <section>
        <h2>Colors</h2>
        <p className={styles.note}>
          Palettes indexed by name and shade: <code>Colors.sage[60]</code>. Components only use the semantic tokens below.
        </p>
        <div className={styles.palettes}>
          {Object.entries(Colors).map(([name, shades]) => (
            <div key={name}>
              <div className={styles.paletteName}>{name}</div>
              <div className={styles.swatches}>
                {Object.entries(shades).map(([shade, hex]) => (
                  <div key={shade} className={styles.swatch}>
                    <span style={{ background: hex }} />
                    <small>
                      {shade}
                      <br />
                      {hex}
                    </small>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <h3>Semantic tokens</h3>
        <div className={styles.tokens}>
          {Object.keys(Theme).map((token) => (
            <div key={token} className={styles.token}>
              <span style={{ background: `var(--${token})` }} />
              <code>--{token}</code>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2>AmButton</h2>
        <p className={styles.note}>
          One component for every button and button-styled link. Pass <code>href</code>, <code>onClick</code>, both, or neither; it picks the right element.
        </p>
        <div className={styles.grid}>
          <Example name="primary" code={`<AmButton variant="primary">`}>
            <AmButton variant="primary">Accept match</AmButton>
          </Example>
          <Example name="secondary (default)" code={`<AmButton>`}>
            <AmButton>Not a transfer</AmButton>
          </Example>
          <Example name="ghost" code={`<AmButton variant="ghost">`}>
            <AmButton variant="ghost">Cancel</AmButton>
          </Example>
          <Example name="link" code={`<AmButton variant="link">`}>
            <AmButton variant="link">Open review</AmButton>
          </Example>
          <Example name="small" code={`<AmButton size="small">`}>
            <AmButton size="small">Undo</AmButton>
          </Example>
          <Example name="disabled" code={`<AmButton variant="primary" disabled>`}>
            <AmButton variant="primary" disabled>
              Bank is up to date
            </AmButton>
          </Example>
          <Example name="as a link" code={`<AmButton href="/">`}>
            <AmButton href="/">Go to review</AmButton>
          </Example>
          <Example name="on a dark bar" code={`<AmButton onDark>`} dark>
            <AmButton onDark>Clear</AmButton>
            <AmButton variant="primary">Accept 26</AmButton>
          </Example>
        </div>
      </section>

      <section>
        <h2>AmPill</h2>
        <p className={styles.note}>Four tones with fixed meanings: positive is done or safe, caution needs a look, negative is undone or wrong, neutral is information.</p>
        <div className={styles.grid}>
          {(["neutral", "positive", "caution", "negative"] as const).map((tone) => (
            <Example key={tone} name={tone} code={`<AmPill tone="${tone}">`}>
              <AmPill tone={tone}>{tone}</AmPill>
            </Example>
          ))}
        </div>
        <h3>Backend values</h3>
        <p className={styles.note}>
          Typed by <code>lib/domain.ts</code>. Every value the database allows is shown, because each component maps over the full list; a new status
          without a label fails the build.
        </p>
        <div className={styles.grid}>
          <Example name="AmTierPill" code={`<AmTierPill tier={p.tier} />`}>
            {MATCH_TIERS.map((t) => (
              <AmTierPill key={t} tier={t} />
            ))}
          </Example>
          <Example name="AmStatusPill" code={`<AmStatusPill status={p.status} />`}>
            {PROPOSAL_STATUSES.map((s) => (
              <AmStatusPill key={s} status={s} />
            ))}
          </Example>
          <Example name="AmKindPill" code={`<AmKindPill kind={p.kind} />`}>
            {MATCH_KINDS.map((k) => (
              <AmKindPill key={k} kind={k} />
            ))}
          </Example>
        </div>
      </section>

      <section>
        <h2>AmMoney</h2>
        <p className={styles.note}>
          Always integer cents in. Three formats, so the same amount never looks different on two screens.
        </p>
        <div className={styles.grid}>
          <Example name="exact, signed (bank lines)" code={`<AmMoney cents={-4000000} signed />`}>
            <AmMoney cents={-4000000} signed />
            <AmMoney cents={7498500} signed emphasizeIn />
          </Example>
          <Example name="whole (summaries)" code={`<AmMoney cents={18876712} format="whole" />`}>
            <AmMoney cents={18876712} format="whole" />
          </Example>
          <Example name="accounting (statements)" code={`<AmMoney cents={-4109100} format="accounting" />`}>
            <AmMoney cents={18876712} format="accounting" />
            <AmMoney cents={-4109100} format="accounting" />
            <AmMoney cents={0} format="accounting" />
          </Example>
        </div>
      </section>

      <section>
        <h2>AmCheckList</h2>
        <p className={styles.note}>
          One component for three places: the reasons behind a match, the pre-flight checks before accepting, and the ready-to-share checks.
        </p>
        <div className={styles.wide}>
          <AmCheckList
            items={[
              { key: "a", label: "Every proposed transfer has been reviewed", state: "pass" },
              {
                key: "b",
                label: "Sales between your businesses are confirmed or dismissed",
                state: "fail",
                detail: "7 to decide, $18,400 that may be counted twice.",
                action: (
                  <AmButton variant="link" size="small">
                    Decide below
                  </AmButton>
                ),
              },
              { key: "c", label: "No uncategorized money moving in or out", state: "warn", detail: "8 transactions, $45,839." },
            ]}
          />
        </div>
      </section>
    </main>
  );
}
