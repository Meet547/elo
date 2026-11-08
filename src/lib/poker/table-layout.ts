/** Separate resting zones for cards, bets, dealer buttons, and the board. */
export const TABLE_W = 1000;
export const TABLE_H = 600;
export const DECK = { x: 500, y: 279 };
export const POT = { x: 118, y: 252 };
export const SEAT_POS = [
  {x:500,y:566},{x:894,y:504},{x:806,y:56},
  {x:500,y:30},{x:194,y:56},{x:106,y:504},
];
export const CARD_POS = [
  {x:500,y:452},{x:872,y:392},{x:806,y:176},
  {x:500,y:138},{x:194,y:176},{x:128,y:392},
];
export const BET_POS = [
  {x:650,y:390},{x:790,y:300},{x:700,y:150},
  {x:620,y:145},{x:300,y:150},{x:210,y:300},
];
export const BUTTON_POS = [
  {x:620,y:450},{x:784,y:420},{x:730,y:105},
  {x:580,y:100},{x:270,y:105},{x:216,y:420},
];
export const BOARD_BOUNDS = {x:255,y:216,width:490,height:126};
export const CARD_BOUNDS = CARD_POS.map((p,index) => index === 0
  ? {x:405,y:374,width:190,height:162}
  : {x:p.x-56,y:p.y-37.8,width:112,height:75.6});
export const BET_BOUNDS = BET_POS.map(p=>({x:p.x-40,y:p.y-30,width:80,height:60}));
