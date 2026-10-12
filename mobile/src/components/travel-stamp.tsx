import { useId, useMemo } from 'react';
import Svg, { Circle, Defs, Ellipse, G, Path, Rect, Text, TextPath } from 'react-native-svg';

import { speckles } from '@shared/paperPrint';
import type { Stamp } from '@shared/travelCard';

const PAPER = '#efe8dc';
const FONT = 'System';

/** A rubber stamp drawn in react-native-svg. Paper-coloured speckles stand in for the web's ink filter. */
export function TravelStamp({ stamp, width }: { stamp: Stamp; width: number }) {
  const { ink, label, date, shape } = stamp;
  const box = shape === 'circle' ? [120, 120] : shape === 'hex' ? [110, 110] : shape === 'rect' ? [150, 84] : [150, 90];
  const boxWidth = box[0];
  const dots = useMemo(() => speckles(label.length * 31 + boxWidth, 46), [label, boxWidth]);
  // Several stamps can render at once, so the TextPath ids must be unique per instance.
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const id = `st-${uid}`;
  const words = label.split(' ');
  const t = (x: number, y: number, size: number, text: string, weight: '700' | '800' = '700', spacing = 0) => (
    <Text x={x} y={y} textAnchor="middle" fontFamily={FONT} fontSize={size} fontWeight={weight} letterSpacing={spacing} fill={ink}>{text}</Text>
  );
  return (
    <Svg width={width} height={(width * box[1]) / box[0]} viewBox={`0 0 ${box[0]} ${box[1]}`} opacity={0.88}>
      <G stroke={ink} fill="none">
        {shape === 'circle' && (
          <>
            <Circle cx={60} cy={60} r={55} strokeWidth={3.2} /><Circle cx={60} cy={60} r={48.5} strokeWidth={1.1} /><Circle cx={60} cy={60} r={31} strokeWidth={1.1} />
            <Defs><Path id={`${id}t`} d="M 20 60 A 40 40 0 0 1 100 60" /><Path id={`${id}b`} d="M 23.5 60 A 36.5 36.5 0 0 0 96.5 60" /></Defs>
            <Text fill={ink} stroke="none" fontFamily={FONT} fontWeight="700" fontSize={9} letterSpacing={2.6}><TextPath href={`#${id}t`} startOffset="50%" textAnchor="middle">TRIPMATE · ADMITTED</TextPath></Text>
            <Text fill={ink} stroke="none" fontFamily={FONT} fontWeight="700" fontSize={8} letterSpacing={2.2}><TextPath href={`#${id}b`} startOffset="50%" textAnchor="middle">{date}</TextPath></Text>
            {label.length > 7 ? <>{t(60, 57, 10.5, words[0], '800', 0.6)}{t(60, 70, 10.5, words.slice(1).join(' '), '800', 0.6)}</> : t(60, 64.5, 13, label, '800', 0.8)}
          </>
        )}
        {shape === 'rect' && (
          <>
            <Rect x={3} y={3} width={144} height={78} rx={7} strokeWidth={3.2} /><Rect x={9.5} y={9.5} width={131} height={65} rx={3} strokeWidth={1.1} />
            <Path d="M22 30H128M22 61H128" strokeWidth={0.9} />
            {t(75, 24.5, 7.6, 'RHYTHM · ENTRY', '700', 2.6)}{t(75, 51, label.length > 12 ? 15 : 17, label, '800', 0.6)}{t(75, 71.5, 7.2, date, '700', 2.4)}
          </>
        )}
        {shape === 'oval' && (
          <>
            <Ellipse cx={75} cy={45} rx={71} ry={41} strokeWidth={3.2} /><Ellipse cx={75} cy={45} rx={64} ry={34.5} strokeWidth={1.1} />
            <Path d="M75 70.5c-4.5-3-8-5.6-8-9a4 4 0 018-1.4 4 4 0 018 1.4c0 3.4-3.5 6-8 9z" strokeWidth={1.3} />
            {t(75, 27, 7.4, 'LOVES', '700', 3)}{t(75, 51.5, label.length > 14 ? 12.5 : 16, label, '800', 0.6)}
          </>
        )}
        {shape === 'hex' && (
          <>
            <Path d="M55 4L99 29.5V80.5L55 106L11 80.5V29.5Z" strokeWidth={3.2} /><Path d="M55 11.5L92.5 33.2V76.8L55 98.5L17.5 76.8V33.2Z" strokeWidth={1.1} />
            <Path d="M40 40.5l26 5.5M51 34l9 9.5M47 49l5 6" strokeWidth={1.6} strokeLinecap="round" />
            {t(55, 33, 7, 'DEPARTS', '700', 2.6)}{t(55, 69, label.length > 8 ? 10.5 : 13, label, '800', 0.6)}{t(55, 82, 6.6, date, '700', 2.2)}
          </>
        )}
      </G>
      {dots.map((d, i) => <Circle key={i} cx={d.x * box[0]} cy={d.y * box[1]} r={d.r * box[0] * 2.2} fill={PAPER} opacity={0.85} />)}
    </Svg>
  );
}
