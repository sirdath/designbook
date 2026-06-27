/* componentRef (plan scene.type) → the scene component. Single source mapping the
   8 reimplemented scene templates; Root.tsx looks each scene up here. */
import { TitleCard } from './scenes/TitleCard';
import { FeatureCard } from './scenes/FeatureCard';
import { StatBurst } from './scenes/StatBurst';
import { LogoReveal } from './scenes/LogoReveal';
import { ScreenshotShowcase } from './scenes/ScreenshotShowcase';
import { QuoteCard } from './scenes/QuoteCard';
import { BulletList } from './scenes/BulletList';
import { CTACard } from './scenes/CTACard';
import { UIDemo } from './scenes/UIDemo';

export const SCENE_COMPONENTS: Record<string, (props: any) => any> = {
  TitleCard,
  FeatureCard,
  StatBurst,
  LogoReveal,
  ScreenshotShowcase,
  QuoteCard,
  BulletList,
  CTACard,
  UIDemo,
};
