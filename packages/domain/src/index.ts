import { z } from 'zod';

export const EvidenceModeSchema = z.enum(['DEMO', 'QLOO', 'METADATA', 'LLM_ONLY']);
export type EvidenceMode = z.infer<typeof EvidenceModeSchema>;
export const FilmFormatSchema = z.enum(['DCP', 'BLURAY', 'DIGITAL', '35MM']);
export type FilmFormat = z.infer<typeof FilmFormatSchema>;
const id = z.string().min(1).max(120);
const timestamp = z.string().datetime({ offset: true });
export const RightsSchema = z.object({
  available: z.boolean().nullable(), territory: z.string().min(2).max(8),
  availableFrom: timestamp, availableTo: timestamp,
  feePence: z.number().int().nonnegative().safe(),
  source: z.enum(['SYNTHETIC', 'USER_PROVIDED']),
  distributor: z.string().min(1).optional(),
}).superRefine((value, ctx) => {
  if (Date.parse(value.availableTo) < Date.parse(value.availableFrom))
    ctx.addIssue({ code: 'custom', message: 'Rights end must not precede rights start' });
});
export type Rights = z.infer<typeof RightsSchema>;
export const FilmSchema = z.object({
  id, title: z.string().min(1), year: z.number().int().min(1888).max(2100),
  runtimeMinutes: z.number().int().positive().max(600),
  genres: z.array(z.string().min(1)).min(1), themes: z.array(z.string().min(1)),
  country: z.string().min(1), formats: z.array(FilmFormatSchema).max(4),
  rights: RightsSchema,
  qlooEntityId: z.string().min(1).nullable().default(null),
  mappingStatus: z.enum(['UNMAPPED', 'AMBIGUOUS', 'CONFIRMED']).default('UNMAPPED'),
});
export type Film = z.infer<typeof FilmSchema>;
export const CohortSeedSchema = z.object({
  name: z.string().min(1), domain: z.enum(['music', 'books', 'places', 'brands', 'film', 'tv', 'artist', 'book', 'movie', 'video_game']),
  entityId: z.string().min(1).nullable().optional(),
});
export type CohortSeed = z.infer<typeof CohortSeedSchema>;
export const CohortSchema = z.object({
  id, name: z.string().min(1), description: z.string().min(1),
  seeds: z.array(CohortSeedSchema).min(2),
});
export type Cohort = z.infer<typeof CohortSchema>;
export const ScreeningSlotSchema = z.object({
  id, label: z.string().min(1), startAt: timestamp, endAt: timestamp, format: FilmFormatSchema,
}).superRefine((value, ctx) => {
  if (Date.parse(value.endAt) <= Date.parse(value.startAt))
    ctx.addIssue({ code: 'custom', message: 'Screening end must follow start' });
});
export type ScreeningSlot = z.infer<typeof ScreeningSlotSchema>;
export type Slot = ScreeningSlot;
export const SlotSchema = ScreeningSlotSchema;
export const ConstraintsSchema = z.object({ territory: z.string().min(2).max(8), budgetPence: z.number().int().nonnegative().safe() });
export type Constraints = z.infer<typeof ConstraintsSchema>;
export const CinemaSchema = z.object({ id, name: z.string(), city: z.string(), territory: z.string(), currency: z.literal('GBP'), timezone: z.string() });
export type Cinema = z.infer<typeof CinemaSchema>;
/** Affinities are evidence scores, never attendance predictions. Null means unknown. */
export const AffinityMatrixSchema = z.record(z.string(), z.record(z.string(), z.number().finite().nullable()));
export type AffinityMatrix = z.infer<typeof AffinityMatrixSchema>;
export const ProgrammeItemSchema = z.object({ slotId: id, filmId: id, feePence: z.number().int().nonnegative().safe() });
export type ProgrammeItem = z.infer<typeof ProgrammeItemSchema>;
export const ProgrammeLockSchema = z.object({ slotId: id, filmId: id });
export type ProgrammeLock = z.infer<typeof ProgrammeLockSchema>;
export type CohortCoverage = { cohortId: string; cohortName: string; score: number; topFilmIds: string[] };
export type ProgrammeObjective = {
  minCoverage: number; averageCoverage: number; diversity: number; savingsPence: number;
};
export const DEMO_NOTICE = 'Illustrative demo only. Rights availability, licence fees and cohort affinities are synthetic. No Qloo response, booking, attendance forecast or real rights clearance is implied.';
export type DemoData = {
  cinema: Cinema; films: Film[]; cohorts: Cohort[]; slots: ScreeningSlot[];
  constraints: Constraints; affinities: AffinityMatrix; evidenceMode: 'DEMO'; notice: string;
};

/** Compact, curated film metadata. Every licence and taste number below is fabricated. */
const catalogue: Array<[string, string, number, number, string, string[], string[]]> = [
  ['spirited-away','Spirited Away',2001,125,'Japan',['Animation','Fantasy'],['wonder','nature']],
  ['moonlight','Moonlight',2016,111,'USA',['Drama'],['identity','intimacy']],
  ['aftersun','Aftersun',2022,102,'UK',['Drama'],['memory','intimacy']],
  ['grand-budapest','The Grand Budapest Hotel',2014,99,'USA',['Comedy','Adventure'],['design','escape']],
  ['portrait-lady-fire','Portrait of a Lady on Fire',2019,122,'France',['Drama','Romance'],['art','intimacy']],
  ['past-lives','Past Lives',2023,106,'USA',['Drama','Romance'],['memory','identity']],
  ['parasite','Parasite',2019,132,'South Korea',['Thriller','Drama'],['society','tension']],
  ['everything-everywhere','Everything Everywhere All at Once',2022,139,'USA',['Science Fiction','Comedy'],['identity','wonder']],
  ['amelie','Amélie',2001,122,'France',['Comedy','Romance'],['design','wonder']],
  ['in-mood-love','In the Mood for Love',2000,98,'Hong Kong',['Drama','Romance'],['intimacy','design']],
  ['perfect-days','Perfect Days',2023,124,'Japan',['Drama'],['nature','music']],
  ['banshees-inisherin','The Banshees of Inisherin',2022,114,'Ireland',['Drama','Comedy'],['society','isolation']],
  ['sound-metal','Sound of Metal',2019,120,'USA',['Drama','Music'],['music','identity']],
  ['whiplash','Whiplash',2014,106,'USA',['Drama','Music'],['music','ambition']],
  ['lives-others','The Lives of Others',2006,137,'Germany',['Drama','Thriller'],['society','art']],
  ['arrival','Arrival',2016,116,'USA',['Science Fiction','Drama'],['language','wonder']],
  ['her','Her',2013,126,'USA',['Science Fiction','Romance'],['design','intimacy']],
  ['wilderpeople','Hunt for the Wilderpeople',2016,101,'New Zealand',['Adventure','Comedy'],['nature','escape']],
  ['farewell','The Farewell',2019,100,'USA',['Drama','Comedy'],['identity','family']],
  ['little-women','Little Women',2019,135,'USA',['Drama','Romance'],['art','family']],
  ['cinema-paradiso','Cinema Paradiso',1988,124,'Italy',['Drama'],['memory','art']],
  ['pans-labyrinth',"Pan’s Labyrinth",2006,119,'Spain',['Fantasy','Drama'],['wonder','society']],
  ['akira','Akira',1988,124,'Japan',['Animation','Science Fiction'],['wonder','society']],
  ['totoro','My Neighbour Totoro',1988,86,'Japan',['Animation','Fantasy'],['nature','family']],
  ['red-turtle','The Red Turtle',2016,81,'France',['Animation','Fantasy'],['nature','isolation']],
  ['florida-project','The Florida Project',2017,111,'USA',['Drama'],['society','family']],
  ['drive','Drive',2011,100,'USA',['Thriller','Crime'],['music','design']],
  ['blade-runner-2049','Blade Runner 2049',2017,164,'USA',['Science Fiction','Thriller'],['design','identity']],
  ['blade-runner','Blade Runner',1982,117,'USA',['Science Fiction','Thriller'],['society','identity']],
  ['paddington-2','Paddington 2',2017,103,'UK',['Comedy','Adventure'],['family','friendship']],
];

export function createDemoData(): DemoData {
  const cinema: Cinema = { id:'lantern', name:'The Lantern Cinema', city:'Bristol', territory:'GB', currency:'GBP', timezone:'Europe/London' };
  const cohorts: Cohort[] = [
    {id:'film-society',name:'Film Society',description:'A fictional cross-domain cohort drawn to intimate stories, literary voices and visual craft.',seeds:[{name:'In the Mood for Love',domain:'movie'},{name:'Normal People',domain:'book'},{name:'Nils Frahm',domain:'artist'}]},
    {id:'alternative-music',name:'Alternative Music',description:'A fictional cross-domain cohort drawn to experimental sound, bold art and unexpected stories.',seeds:[{name:'Radiohead',domain:'artist'},{name:'Björk',domain:'artist'},{name:'Just Kids',domain:'book'}]},
    {id:'gaming-speculative',name:'Gaming & Speculative Fiction',description:'A fictional cross-domain cohort drawn to speculative worlds, cultural questions and stories of belonging.',seeds:[{name:'Cyberpunk 2077',domain:'video_game'},{name:'Neuromancer',domain:'book'},{name:'Blade Runner',domain:'movie'}]},
  ];
  const films: Film[] = catalogue.map(([filmId,title,year,runtimeMinutes,country,genres,themes], i) => ({
    id:filmId,title,year,runtimeMinutes,country,genres:[...genres],themes:[...themes],formats:i===28?['BLURAY']:['DCP','BLURAY'],
    rights:{available:i!==26,territory:i===27?'US':'GB',availableFrom:'2026-10-01T00:00:00Z',availableTo:'2026-12-31T23:59:59Z',feePence:30000+((i*7)%12)*2500,source:'SYNTHETIC',distributor:`Demo distributor ${1+(i%4)} — synthetic`},
    qlooEntityId:null,mappingStatus:'UNMAPPED',
  }));
  const slots: ScreeningSlot[] = [
    {id:'fri-early',label:'Friday · early',startAt:'2026-10-16T17:00:00Z',endAt:'2026-10-16T19:30:00Z',format:'DCP'},
    {id:'fri-late',label:'Friday · late',startAt:'2026-10-16T19:45:00Z',endAt:'2026-10-16T22:15:00Z',format:'DCP'},
    {id:'sat-early',label:'Saturday · early',startAt:'2026-10-17T16:00:00Z',endAt:'2026-10-17T18:30:00Z',format:'DCP'},
    {id:'sat-late',label:'Saturday · late',startAt:'2026-10-17T19:00:00Z',endAt:'2026-10-17T21:45:00Z',format:'DCP'},
  ];
  // Illustrative curatorial assumptions, not measured tastes: literary cinema, music-led stories, speculative worlds.
  const affinityVectors: number[][] = [
    [.68,.97,.99,.72,.98,.96,.69,.59,.83,.95,.94,.76,.85,.78,.86,.82,.92,.62,.88,.89,.91,.65,.48,.60,.64,.77,.58,.73,.52,.55],
    [.78,.93,.86,.92,.84,.82,.75,.87,.88,.89,.96,.73,.99,.98,.79,.85,.94,.69,.71,.83,.90,.76,.80,.65,.67,.81,.97,.91,.77,.63],
    [.94,.75,.58,.78,.62,.65,.89,.95,.71,.69,.72,.61,.76,.74,.81,.97,.92,.82,.66,.60,.64,.93,.99,.86,.84,.68,.87,.96,.98,.80],
  ];
  const affinities: AffinityMatrix = Object.fromEntries(cohorts.map((cohort,c) => [cohort.id,Object.fromEntries(films.map((film,i)=>[film.id,affinityVectors[c]![i]!]))]));
  return {cinema,films,cohorts,slots,constraints:{territory:'GB',budgetPence:185000},affinities,evidenceMode:'DEMO',notice:DEMO_NOTICE};
}
export const DemoDataSchema = z.object({cinema:CinemaSchema,films:z.array(FilmSchema),cohorts:z.array(CohortSchema),slots:z.array(ScreeningSlotSchema),constraints:ConstraintsSchema,affinities:AffinityMatrixSchema,evidenceMode:z.literal('DEMO'),notice:z.string()});
export * from './taste';
