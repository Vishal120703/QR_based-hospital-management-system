import {
  Accessibility,
  Baby,
  Bath,
  BedDouble,
  Brush,
  Coffee,
  ConciergeBell,
  Droplet,
  Ellipsis,
  GlassWater,
  HeartPulse,
  Pill,
  Receipt,
  Salad,
  Sparkles,
  Stethoscope,
  Thermometer,
  Utensils,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { type PublicCategory } from '../../api';

type Tone = 'blue' | 'rose' | 'green' | 'violet' | 'amber' | 'teal';
const tones: Tone[] = ['blue', 'rose', 'green', 'violet', 'amber', 'teal'];

// Services and categories are named by each hospital, so icons and colours
// are chosen from common words in the name, with a neutral fallback.
const categoryLooks: { match: RegExp; icon: LucideIcon; tone: Tone }[] = [
  { match: /water|food|meal|diet|drink|pantry|kitchen|canteen/i, icon: GlassWater, tone: 'blue' },
  { match: /nurs|medic|doctor|health|clinical|pain/i, icon: HeartPulse, tone: 'rose' },
  { match: /clean|room|housekeep|laundry|linen|hygiene/i, icon: Sparkles, tone: 'green' },
  { match: /assist|mobility|wheel|transport|porter|help/i, icon: Accessibility, tone: 'violet' },
  { match: /maint|repair|electric|plumb|light|fan|\bac\b/i, icon: Wrench, tone: 'amber' },
  { match: /bill|pay|insurance|discharge|account/i, icon: Receipt, tone: 'teal' },
];

const serviceIcons: { match: RegExp; icon: LucideIcon }[] = [
  { match: /water|drink/i, icon: Droplet },
  { match: /diet|salad|fruit/i, icon: Salad },
  { match: /tea|coffee/i, icon: Coffee },
  { match: /food|meal|breakfast|lunch|dinner|snack/i, icon: Utensils },
  { match: /nurse|doctor|check/i, icon: Stethoscope },
  { match: /medicine|pill|tablet|drug/i, icon: Pill },
  { match: /pain|fever|temperature/i, icon: Thermometer },
  { match: /linen|sheet|blanket|pillow|bed/i, icon: BedDouble },
  { match: /toilet|bath|wash|shower/i, icon: Bath },
  { match: /clean|sweep|mop|dust/i, icon: Brush },
  { match: /wheel|chair|mobility|transport|stretcher|walk/i, icon: Accessibility },
  { match: /repair|light|fan|electric|plumb|\bac\b|tv/i, icon: Wrench },
  { match: /bill|pay/i, icon: Receipt },
  { match: /baby|infant|feed/i, icon: Baby },
  { match: /other|misc/i, icon: Ellipsis },
];

export function categoryLook(category: PublicCategory, index: number) {
  const text = `${category.name} ${category.description ?? ''}`;
  const found = categoryLooks.find((look) => look.match.test(text));
  return found ?? { icon: ConciergeBell, tone: tones[index % tones.length]! };
}

export function serviceIcon(name: string, fallback: LucideIcon): LucideIcon {
  return serviceIcons.find((look) => look.match.test(name))?.icon ?? fallback;
}
