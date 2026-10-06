/** Shared types for the Crosswalk engine. Everything here is plain data. */

// ---------------------------------------------------------------------------
// Cost sharing
// ---------------------------------------------------------------------------

/**
 * How a plan shares the cost of one service. Mirrors the shapes a Summary of
 * Benefits and Coverage actually uses.
 *
 * - copay                  flat amount, deductible does not apply
 * - deductible             member pays the allowed amount until the deductible
 *                          is met, then the plan's coinsurance share
 * - coinsurance            member pays a fixed share, deductible does not apply
 * - copay_after_deductible deductible first, then a flat amount
 * - coins_after_deductible deductible first, then a specific coinsurance share
 */
export type CostSharingRule =
  | { kind: 'copay'; amount: number }
  | { kind: 'deductible' }
  | { kind: 'coinsurance'; rate: number }
  | { kind: 'copay_after_deductible'; amount: number }
  | { kind: 'coins_after_deductible'; rate: number };

/** Service categories a plan prices separately. */
export type ServiceKind =
  | 'preventive' | 'pcp' | 'specialist' | 'labs' | 'imaging' | 'imaging_adv'
  | 'er' | 'admission' | 'delivery' | 'event';

/** Drug tiers a plan prices separately. */
export type DrugKind = 'generic' | 'brand' | 'specialty' | 'insulin';

/** Why a member's share of one claim was reduced below the plan's own rules. */
export type CostShareCap = 'oop_max' | 'state_insulin_cap' | null;

/** The rule that actually governed one claim. */
export type AppliedRule = CostSharingRule['kind'] | 'preventive_no_cost';

/**
 * What happened on one claim. This is the engine's explanation of a single
 * line of care: it is what the "use your benefits" walkthrough reads, and what
 * the simulation sums. Pure data, safe to serialise.
 */
export interface ClaimExplanation {
  /** Service category or drug tier this claim was priced under. */
  readonly category: ServiceKind | DrugKind;
  /** Negotiated amount the plan recognises for the service. */
  readonly allowedAmount: number;
  /** Which cost-sharing rule governed it. */
  readonly ruleApplied: AppliedRule;
  /** How much of the allowed amount went against the deductible. */
  readonly towardDeductible: number;
  /** What the member paid. */
  readonly patientPaid: number;
  /** What the plan paid. */
  readonly planPaid: number;
  /** Set when a cap cut the member's share below the plan's own rules. */
  readonly cappedBy: CostShareCap;
  /** Deductible left after this claim. */
  readonly deductibleRemaining: number;
  /** Distance left to the out-of-pocket maximum after this claim. */
  readonly oopRemaining: number;
  /** Plan-year month, 1-12. */
  readonly month: number;
  /** Human label, where the claim has one (events, named drugs). */
  readonly label?: string;
}

/** A plan's cost-sharing design. The part of a plan the engine reasons about. */
export interface PlanDesign {
  readonly deductible: number;
  readonly /** Default coinsurance once the deductible is met. */ coinsurance: number;
  readonly outOfPocketMax: number;
  readonly rules: Readonly<Partial<Record<ServiceKind | DrugKind, CostSharingRule>>>;
  /** Whether the plan qualifies for an HSA. */
  readonly hsaEligible: boolean;
}

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

export type MetalLevel = 'Bronze' | 'Silver' | 'Gold' | 'Platinum' | 'Catastrophic';

/** Formulary status for one drug on one plan. */
export type FormularyStatus = 'covered' | 'pa' | 'not_covered';

export interface Plan extends PlanDesign {
  readonly id: string;
  readonly name: string;
  readonly metal: MetalLevel;
  readonly planType: string;
  /** Display label, e.g. "Silver HMO". */
  readonly label: string;
  /** Monthly premium for a 21-24 year old before the age curve is applied. */
  readonly basePremium: number;
  /** The age the basePremium is quoted at, so the curve can be re-based. */
  readonly basePremiumAge: number;
  /** Provider ids in network. Simulated -- the PUFs carry no provider rosters. */
  readonly network: readonly string[];
  /** Drug id to formulary status. Simulated, for the same reason. */
  readonly formulary: Readonly<Record<string, FormularyStatus>>;
  /** Phase B fields, absent in the fallback dataset. */
  readonly issuer?: string;
  readonly hiosPlanId?: string;
  readonly county?: string;
  readonly sbcUrl?: string;
  readonly formularyUrl?: string;
  readonly providerDirectoryUrl?: string;
}

/** A set of plans sold in one place for one plan year. */
export interface PlanDataset {
  readonly id: string;
  readonly label: string;
  readonly state: string;
  readonly planYear: number;
  /**
   * Multiplier taking the dataset's quoted premiums to the modeled plan year.
   * 1.0 where the premiums are already at plan-year level.
   */
  readonly premiumTrend: number;
  /** Whether network and formulary data are real or simulated. */
  readonly networkDataIsReal: boolean;
  readonly source: string;
  readonly plans: readonly Plan[];
}

// ---------------------------------------------------------------------------
// Projected care
// ---------------------------------------------------------------------------

/** One expected line of care in a simulated plan year. */
export interface CareLine {
  readonly month: number;
  readonly kind: ServiceKind | 'drug';
  readonly allowedAmount?: number;
  readonly drugId?: string;
  readonly label?: string;
}

/** A person's projected year, before any plan is applied. */
export type Scenario = readonly CareLine[];

/** What a person's records imply about next year, as the engine needs it. */
export interface CareProjection {
  /** Recurring and scheduled care, by category. */
  readonly services: readonly ProjectedService[];
  /** Expected drug fills. */
  readonly drugs: readonly ProjectedDrug[];
  /** Possible one-off events, with probabilities. */
  readonly events: readonly ProjectedEvent[];
  /** Background rates for unplanned care. */
  readonly rates: BackgroundRates;
}

/** Months a service falls in: fixed months, evenly spread, or random. */
export type MonthSpec = readonly number[] | 'spread' | 'random';

export interface ProjectedService {
  readonly kind: ServiceKind;
  readonly count: number;
  readonly months: MonthSpec;
  /** Projection group this belongs to, so the UI can switch it off. */
  readonly group: string | null;
}

export interface ProjectedDrug {
  readonly drugId: string;
  readonly fills: number;
  readonly group: string | null;
}

export interface ProjectedEvent {
  readonly label: string;
  readonly probability: number;
  /** Median allowed amount; the simulation draws lognormally around it. */
  readonly medianAmount: number;
  readonly sigma: number;
  readonly month: number | 'random';
  readonly group: string | null;
}

export interface BackgroundRates {
  /** Expected emergency visits per year. */
  readonly er: number;
  /** Expected inpatient admissions per year. */
  readonly admission: number;
  /** Chance of a serious unexpected illness or injury. */
  readonly major: number;
}

// ---------------------------------------------------------------------------
// Prices
// ---------------------------------------------------------------------------

export type PriceTable = Readonly<Record<ServiceKind, number>>;

export interface Drug {
  readonly id: string;
  readonly name: string;
  readonly allowedAmount: number;
  readonly kind: DrugKind;
  /** What the plan would cover instead where this drug is not on formulary. */
  readonly alternative?: { readonly name: string; readonly allowedAmount: number; readonly kind: DrugKind };
}

export type DrugTable = Readonly<Record<string, Drug>>;

export interface Provider {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  /** Losing this provider is treated as a care disruption, not a note. */
  readonly critical: boolean;
}

export type ProviderTable = Readonly<Record<string, Provider>>;

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

export type FlagSeverity = 'high' | 'note';

/** Something about a plan a person should know before choosing it. */
export interface PlanFlag {
  readonly severity: FlagSeverity;
  readonly text: string;
  /** Short form for inline lists. */
  readonly short?: string;
}

/** One plan's modeled outcome for one person. */
export interface PlanOutcome {
  readonly plan: Plan;
  /** Monthly premium before any allowance or credit. */
  readonly grossPremium: number;
  /** Monthly premium after the allowance. */
  readonly netPremium: number;
  readonly meanTotal: number;
  readonly p10: number;
  readonly p50: number;
  readonly p90: number;
  /** Cumulative member cost by month in the typical year. */
  readonly typicalCumulative: readonly number[];
  readonly typicalOutOfPocket: number;
  /** Claim-by-claim explanation of the typical year. */
  readonly typicalClaims: readonly ClaimExplanation[];
  readonly flags: readonly PlanFlag[];
  /** True where the plan would drop critical care. These rank last. */
  readonly disruptsCare: boolean;
}

/** Loose shape of a priced year, for callers that only need the totals. */
export interface YearResultLike {
  readonly outOfPocket: number;
  readonly byMonth: readonly number[];
}
