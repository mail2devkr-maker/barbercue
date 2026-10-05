import type { Metadata } from "next";
import Link from "next/link";
import { CustomerShell } from "../../../components/layout/CustomerShell";
import { absoluteUrl } from "../../../lib/seo";
import styles from "../../../components/landing/info-page.module.css";

const TITLE = "HR Policy";
const DESCRIPTION =
  "Public HR policy summary for Fastque Digital Technology Private Limited covering employment standards, probation, performance, conduct, confidentiality, incentives, resignation and employee support.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: absoluteUrl("/hr-policy") },
  openGraph: {
    title: `${TITLE} | FastQue`,
    description: DESCRIPTION,
    url: absoluteUrl("/hr-policy"),
    type: "website",
  },
};

const COMPANY = "Fastque Digital Technology Private Limited";

export default function HrPolicyPage() {
  return (
    <CustomerShell>
      <main className={styles.page}>
        <section className={styles.hero}>
          <p className={styles.eyebrow}>People &amp; workplace</p>
          <h1>HR Policy</h1>
          <p className={styles.lead}>
            This page is the public HR policy summary of {COMPANY}. It sets baseline expectations
            for employees and candidates while keeping employee-specific written terms, company
            notices and applicable law authoritative where they are more specific.
          </p>
          <div className={styles.heroActions}>
            <Link href="/careers" className={styles.primary}>Careers</Link>
            <a href="mailto:support@fastque.com?subject=FastQue%20HR%20Support" className={styles.secondary}>
              HR support
            </a>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.story}>
            <div>
              <p className={styles.eyebrow}>Policy status</p>
              <h2>Clear rules, written terms, fair process.</h2>
            </div>
            <div>
              <p><strong>Company:</strong> {COMPANY}</p>
              <p><strong>Published:</strong> 5 October 2026</p>
              <p>
                This public policy is intended to explain general workplace standards. It is not a
                substitute for an employee&apos;s offer letter, employment agreement, role-specific
                policy, statutory entitlement or legally required procedure.
              </p>
            </div>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <p className={styles.eyebrow}>1 · Scope &amp; principles</p>
            <h2>Who this policy applies to.</h2>
          </div>
          <div className={styles.policyBody}>
            <p>
              This policy applies as a baseline to employees of {COMPANY}, including field-sales and
              shop-onboarding personnel, unless a written employment document states a more specific
              term. Contractors, interns or other engagements may be governed by separate written terms.
            </p>
            <p>
              FastQue expects lawful, respectful, honest and professional conduct. Employment
              decisions and workplace actions should be based on legitimate business requirements,
              performance, conduct and applicable law.
            </p>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <p className={styles.eyebrow}>2 · Joining, documents &amp; verification</p>
            <h2>Accurate information is required.</h2>
          </div>
          <div className={styles.policyBody}>
            <p>
              Candidates and employees must provide truthful information about identity,
              qualifications, experience and documents requested for lawful onboarding. Materially
              false or misleading information may affect an offer or continued employment, subject to
              a fair review and applicable law.
            </p>
            <p>
              Sensitive documents should be shared only through approved company channels when
              requested. Passwords, OTPs and personal account credentials must never be shared with
              managers, recruiters, field staff or support personnel.
            </p>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <p className={styles.eyebrow}>3 · Probation &amp; confirmation</p>
            <h2>Three-month probation for the current field-sales offer structure.</h2>
          </div>
          <div className={styles.policyBody}>
            <p>
              The current Field Sales &amp; Shop Onboarding offer structure uses a probation period
              of three (3) months from the joining date.
            </p>
            <p>
              Probation may be extended based on performance, conduct, attendance, role readiness or
              completion of the company&apos;s assessment process. Confirmation, extension or any
              other probation decision should be communicated through the company&apos;s written process.
            </p>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <p className={styles.eyebrow}>4 · Attendance, work &amp; reporting</p>
            <h2>Be present, reachable and accurate.</h2>
          </div>
          <div className={styles.policyBody}>
            <p>
              Employees are expected to follow assigned work schedules, attendance requirements,
              territory or field assignments, reporting instructions and reasonable operational
              directions applicable to their role.
            </p>
            <p>
              Employees must record visits, leads, shop onboarding progress and other work activity
              accurately. False entries, duplicate onboarding, fabricated visits or manipulation of
              performance records are prohibited.
            </p>
            <p>
              If an employee cannot attend work or complete an assigned duty, they should inform the
              designated manager or company contact as early as reasonably possible and follow the
              applicable leave or absence process.
            </p>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <p className={styles.eyebrow}>5 · Compensation, targets &amp; incentives</p>
            <h2>Performance-linked terms must be measurable.</h2>
          </div>
          <div className={styles.policyBody}>
            <p>
              Salary, CTC, payroll timing and statutory treatment are governed by the employee&apos;s
              written offer or employment terms, approved payroll configuration and applicable law.
            </p>
            <div className={styles.policyHighlight}>
              <strong>Current Field Sales &amp; Shop Onboarding performance structure</strong>
              <p>
                Eligibility for the committed salary requires a minimum of <strong>85 verified shop
                onboardings</strong> in the applicable performance period.
              </p>
              <p>
                For shop onboardings numbered <strong>86 through 100</strong>, the incentive is
                <strong> INR 60 per shop</strong> for each shop in that slab.
              </p>
              <p>
                From the <strong>101st verified shop onward</strong>, the incentive is
                <strong> INR 100 per additional shop</strong>.
              </p>
            </div>
            <p>
              A shop counts only after FastQue determines that the onboarding is genuine and
              sufficiently complete for verification. Duplicate, fake, fraudulent or materially
              incomplete registrations do not count toward targets or incentives.
            </p>
            <p>
              Role-specific written offer terms may define the applicable performance period,
              territory, verification requirements or additional eligibility conditions.
            </p>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <p className={styles.eyebrow}>6 · Performance management</p>
            <h2>Performance is more than a number.</h2>
          </div>
          <div className={styles.policyBody}>
            <p>
              Performance may be assessed using role-specific targets together with quality,
              accuracy, conduct, attendance, customer or shop feedback, policy compliance and
              completion of assigned responsibilities.
            </p>
            <p>
              Managers may provide coaching, written feedback, improvement expectations or a
              performance-improvement process when appropriate. Performance concerns should be
              documented and reviewed fairly before material employment action, subject to the
              applicable employment terms and law.
            </p>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <p className={styles.eyebrow}>7 · Leave &amp; time off</p>
            <h2>Use the approved leave process.</h2>
          </div>
          <div className={styles.policyBody}>
            <p>
              Leave, weekly rest, holidays and other statutory or company time-off entitlements are
              administered according to applicable law, role-specific terms and current company
              policy. Employees should request planned leave in advance through the designated
              channel wherever practicable.
            </p>
            <p>
              Emergencies and illness should be reported promptly. Approval requirements do not
              remove any statutory entitlement that applies to an employee.
            </p>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <p className={styles.eyebrow}>8 · Respectful workplace</p>
            <h2>Harassment, discrimination and retaliation are not acceptable.</h2>
          </div>
          <div className={styles.policyBody}>
            <p>
              Employees must treat colleagues, candidates, customers, shop owners and partners with
              dignity and professional respect. Harassment, bullying, discriminatory conduct,
              threats, intimidation or retaliation for raising a good-faith concern are prohibited.
            </p>
            <p>
              Concerns may be raised with the employee&apos;s manager or through support@fastque.com.
              Where applicable law requires a designated complaint mechanism, committee or officer,
              the company will route the complaint through the required process.
            </p>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <p className={styles.eyebrow}>9 · Confidentiality, privacy &amp; information security</p>
            <h2>Protect company, customer and partner information.</h2>
          </div>
          <div className={styles.policyBody}>
            <p>
              Employees must protect confidential information, customer and shop data, credentials,
              source code, pricing, internal documents, business plans and other non-public
              information obtained through their role.
            </p>
            <p>
              Company information should be accessed only for authorised work. Employees must follow
              security instructions, use approved systems, protect devices and accounts, and report
              suspected loss, unauthorised access or data exposure promptly.
            </p>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <p className={styles.eyebrow}>10 · Conflicts, gifts &amp; improper payments</p>
            <h2>Business must be conducted honestly.</h2>
          </div>
          <div className={styles.policyBody}>
            <p>
              Employees must avoid undisclosed conflicts of interest and must not offer, request or
              accept unauthorised payments, kickbacks, commissions or personal benefits in exchange
              for employment, onboarding, approvals or business decisions.
            </p>
            <p>
              Employees must not promise discounts, commercial commitments, contracts or other
              obligations on behalf of the company unless they are specifically authorised to do so.
            </p>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <p className={styles.eyebrow}>11 · Company property &amp; expenses</p>
            <h2>Use resources only for authorised purposes.</h2>
          </div>
          <div className={styles.policyBody}>
            <p>
              Company devices, accounts, documents, access rights, intellectual property and other
              assets remain company property where applicable and must be protected and returned
              when requested or when employment ends.
            </p>
            <p>
              Reimbursement is limited to expenses that are permitted by the applicable role or
              approved company process. Employees should not assume that an unapproved expense will
              be reimbursed.
            </p>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <p className={styles.eyebrow}>12 · Resignation, notice &amp; final clearance</p>
            <h2>One month written notice for the current field-sales offer structure.</h2>
          </div>
          <div className={styles.policyBody}>
            <p>
              Under the current Field Sales &amp; Shop Onboarding offer terms, an employee who wishes
              to resign must provide at least <strong>one (1) month / 30 days prior written
              notice</strong> to the company.
            </p>
            <p>
              Any reduction or waiver of the notice period requires written company approval and is
              subject to the employee&apos;s applicable written terms and law. Employees must complete
              reasonable handover, return company property and complete applicable clearance steps.
            </p>
            <p>
              Final settlement, statutory dues and employment records will be processed according to
              the applicable employment terms, completed clearance and law.
            </p>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <p className={styles.eyebrow}>13 · Discipline &amp; separation</p>
            <h2>Serious issues require documented review.</h2>
          </div>
          <div className={styles.policyBody}>
            <p>
              Policy breaches, fraud, harassment, serious misconduct, repeated performance failure,
              unauthorised disclosure, falsified work records or other material violations may lead
              to corrective or disciplinary action.
            </p>
            <p>
              The appropriate process and outcome depend on the facts, the employee&apos;s written
              terms and applicable law. Nothing in this policy removes any legally required notice,
              inquiry, hearing, payment or other protection.
            </p>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <p className={styles.eyebrow}>14 · Grievances &amp; reporting concerns</p>
            <h2>Raise concerns without retaliation.</h2>
          </div>
          <div className={styles.policyBody}>
            <p>
              Employees should raise payroll, manager, conduct, harassment, safety, data-security or
              employment concerns through their manager or the company support route. A concern may
              be escalated when the direct manager is involved or the issue has not been resolved.
            </p>
            <p>
              Good-faith reporting must not be used as a reason for retaliation. Deliberately false
              allegations or fabricated evidence may themselves be reviewed as misconduct.
            </p>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <p className={styles.eyebrow}>15 · Policy updates</p>
            <h2>Current written terms matter.</h2>
          </div>
          <div className={styles.policyBody}>
            <p>
              {COMPANY} may update this policy to reflect operational, legal or organisational
              changes. Material employee-facing changes should be communicated through an
              appropriate company channel.
            </p>
            <p>
              If this public summary conflicts with a mandatory law or a more specific signed
              employment document, the mandatory law and applicable written employment terms govern
              to the extent of that conflict.
            </p>
          </div>
        </section>

        <section className={styles.finalCta}>
          <p className={styles.eyebrow}>HR contact</p>
          <h2>Need a policy clarification?</h2>
          <p>
            Employees and candidates can write to support@fastque.com with an HR-related subject.
            Do not include passwords or OTPs.
          </p>
          <div className={styles.cardActions}>
            <a href="mailto:support@fastque.com?subject=FastQue%20HR%20Support" className={styles.primary}>
              Contact HR support
            </a>
            <Link href="/faq" className={styles.secondary}>Read FAQs</Link>
          </div>
        </section>
      </main>
    </CustomerShell>
  );
}
