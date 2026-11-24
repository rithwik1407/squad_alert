/** Short IGL tips and motivation lines. One is shown per day (same for the whole team). */
export const TIPS: { kind: 'IGL tip' | 'Motivation'; text: string }[] = [
  { kind: 'IGL tip', text: 'Call the rotation before the zone shrinks, not after. Early moves win compounds.' },
  { kind: 'IGL tip', text: 'One voice on comms during a fight. Everyone else calls only enemy count and position.' },
  { kind: 'IGL tip', text: 'Use utility before you push: two smokes and a frag beat a blind peek every time.' },
  { kind: 'IGL tip', text: 'Third zone is where placement points are won. Play for position, not kills.' },
  { kind: 'IGL tip', text: 'Agree on a fallback compound before every rotate, so nobody gets stranded.' },
  { kind: 'IGL tip', text: 'Knocked an enemy? Call "one down, three left" so the squad knows when to swing.' },
  { kind: 'IGL tip', text: 'Vehicles are cover in late zones. Park them as a wall, not in the open.' },
  { kind: 'IGL tip', text: 'Edge play keeps your back safe; center play gives you options. Pick one and commit.' },
  { kind: 'IGL tip', text: 'Review one death from yesterday\'s scrim. Fix the call, not the player.' },
  { kind: 'IGL tip', text: 'Split drops cost points. Land together unless the plan says otherwise.' },
  { kind: 'IGL tip', text: 'Keep two smokes for the last zone. They buy the revive that wins the chicken.' },
  { kind: 'IGL tip', text: 'Count teams left before every fight. Fewer teams means patience pays more.' },
  { kind: 'IGL tip', text: 'Assign roles before the match: entry, support, scout, IGL. No overlap, no confusion.' },
  { kind: 'IGL tip', text: 'Hold high ground in the final circles; make them come to you.' },
  { kind: 'IGL tip', text: 'Don\'t chase kill feed. Points from placement are steadier than risky third-parties.' },
  { kind: 'IGL tip', text: 'Loot fast, then reposition. The first team to the next compound sets the fight.' },
  { kind: 'IGL tip', text: 'After a wipe, heal and reset before looting. Third parties hit loot-boxers.' },
  { kind: 'IGL tip', text: 'Scout with one player, rotate with three. Information first, bodies second.' },
  { kind: 'IGL tip', text: 'Plan the drop for every map and stick with it across the scrim day.' },
  { kind: 'IGL tip', text: 'Short, clear calls: direction, distance, number. "North rock, 100, two."' },
  { kind: 'Motivation', text: 'Champions are built in scrims nobody watches.' },
  { kind: 'Motivation', text: 'One bad match is data, not destiny. Reset and run it back.' },
  { kind: 'Motivation', text: 'Play for the squad. Four players, one brain.' },
  { kind: 'Motivation', text: 'Discipline beats talent when talent doesn\'t show up on time.' },
  { kind: 'Motivation', text: 'Every chicken dinner starts with a calm drop.' },
  { kind: 'Motivation', text: 'Win the small fights: the rotation, the revive, the smoke. The big one follows.' },
  { kind: 'Motivation', text: 'Show up, communicate, improve 1% today.' },
  { kind: 'Motivation', text: 'Trust the call, then make it right.' },
  { kind: 'Motivation', text: 'Pressure is a privilege. It means you\'re in the final circle.' },
  { kind: 'Motivation', text: 'Stay humble in the lobby, loud on comms.' },
];

/** Today's tip (India time), so everyone sees the same one and it changes at midnight. */
export function tipOfTheDay(now = new Date()) {
  const ist = new Date(now.getTime() + 330 * 60_000);
  const day = Math.floor(ist.getTime() / 864e5);
  return TIPS[day % TIPS.length];
}
