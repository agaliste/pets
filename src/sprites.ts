// Pixel-art data: coding mascots, hats, accessories and office props.
// In every sprite '.' is transparent; other characters index the palette.

import type { Palette, Sprite } from "./canvas.ts";

export const C = {
  body: 0xd97757,
  bodyDark: 0x9c4f36,
  eye: 0x1f1f1f,
  white: 0xf2f2f2,
  black: 0x111111,
} as const;

export const MASCOT_PALETTE: Palette = {
  "#": C.body,
  "o": C.eye,
  "=": C.bodyDark,
};

export const MASCOT_W = 12;
export const MASCOT_H = 8;

/** Mascot frames. All are 12 wide, 8 tall; the head is row 0 (ears). */
export const MASCOT = {
  stand: [
    "..#......#..",
    ".##########.",
    ".##o####o##.",
    "############",
    "############",
    ".##########.",
    "...##..##...",
    "...##..##...",
  ],
  walkA: [
    "..#......#..",
    ".##########.",
    ".##o####o##.",
    "############",
    "############",
    ".##########.",
    "..##....##..",
    "..##....##..",
  ],
  walkB: [
    "..#......#..",
    ".##########.",
    ".##o####o##.",
    "############",
    "############",
    ".##########.",
    "....##.##...",
    "....##.##...",
  ],
  typeA: [
    "..#......#..",
    ".##########.",
    ".##o####o##.",
    "############",
    ".##########.",
    ".##########.",
    "...##..##...",
    "...##..##...",
  ],
  typeB: [
    "..#......#..",
    ".##########.",
    ".##o####o##.",
    ".##########.",
    "############",
    ".##########.",
    "...##..##...",
    "...##..##...",
  ],
  kick: [
    "..#......#..",
    ".##########.",
    ".##o####o##.",
    "############",
    "############",
    ".##########.",
    "...##...####",
    "...##.......",
  ],
  wave: [
    "..#......#.#",
    ".###########",
    ".##o####o##.",
    "###########.",
    "###########.",
    ".##########.",
    "...##..##...",
    "...##..##...",
  ],
  sleep: [
    "..#......#..",
    ".##########.",
    ".##=####=##.",
    "############",
    "############",
    ".##########.",
    "...##..##...",
    "...##..##...",
  ],
  sit: [
    "..#......#..",
    ".##########.",
    ".##o####o##.",
    "############",
    "############",
    ".##########.",
    "............",
    "............",
  ],
} satisfies Record<string, string[]>;

export type MascotFrame = keyof typeof MASCOT;

export const CODEX_PALETTE: Palette = {
  "#": 0xe7edf2,
  "=": 0x8b9ba8,
  "o": 0x18242d,
  "*": 0x72dfd0,
};

// A terminal-faced robot. Same footprint and hat anchor as Claude.
const ROBOT_HEAD = ["...######...", "..########..", "..#oooooo#..", "..#o*oo*o#.."];
export const CODEX_MASCOT: Record<MascotFrame, string[]> = {
  stand: [...ROBOT_HEAD, ".##########.", "..##====##..", "...##..##...", "...==..==..."],
  walkA: [...ROBOT_HEAD, ".##########.", "..##====##..", "..##....##..", "..==....==.."],
  walkB: [...ROBOT_HEAD, ".##########.", "..##====##..", "....##.##...", "....==.==..."],
  typeA: [...ROBOT_HEAD, ".#########..", "..##====###.", "...##..##...", "...==..==..."],
  typeB: [...ROBOT_HEAD, "..#########.", ".###====##..", "...##..##...", "...==..==..."],
  kick: [...ROBOT_HEAD, ".##########.", "..##====##..", "...##...####", "...==......."],
  wave: ["...######.#.", "..#########.", "..#oooooo##.", "..#o*oo*o#..", ".#########..", "..##====##..", "...##..##...", "...==..==..."],
  sleep: ["...######...", "..########..", "..#oooooo#..", "..#o=oo=o#..", ".##########.", "..##====##..", "...##..##...", "...==..==..."],
  sit: [...ROBOT_HEAD, ".##########.", "..##====##..", "............", "............"],
};

// OpenCode is a charcoal terminal with a mint prompt and little feet.
export const OPENCODE_PALETTE: Palette = {
  "#": 0x74808a, "=": 0x37424f, "o": 0x17202a, "*": 0xa3e6b4,
};
const TERMINAL_HEAD = [".##########.", ".#oooooooo#.", ".#o*oooooo#.", ".#oo*o**oo#."];
export const OPENCODE_MASCOT: Record<MascotFrame, string[]> = {
  stand: [...TERMINAL_HEAD, ".#o*oooooo#.", ".##########.", "...==..==...", "..###..###.."],
  walkA: [...TERMINAL_HEAD, ".#o*oooooo#.", ".##########.", "..==....==..", ".###....###."],
  walkB: [...TERMINAL_HEAD, ".#o*oooooo#.", ".##########.", "....==.==...", "...###.###.."],
  typeA: [...TERMINAL_HEAD, "##o*oooooo#.", "=##########.", "...==..==...", "..###..###.."],
  typeB: [...TERMINAL_HEAD, ".#o*oooooo##", ".##########=", "...==..==...", "..###..###.."],
  kick: [...TERMINAL_HEAD, ".#o*oooooo#.", ".##########.", "...==...####", "..###......."],
  wave: [".###########", ".#oooooooo#=", ".#o*oooooo#.", ".#oo*o**oo#.", ".#o*oooooo#.", ".##########.", "...==..==...", "..###..###.."],
  sleep: [".##########.", ".#oooooooo#.", ".#oooooooo#.", ".#o==o==oo#.", ".#oooooooo#.", ".##########.", "...==..==...", "..###..###.."],
  sit: [...TERMINAL_HEAD, ".#o*oooooo#.", ".##########.", "............", "............"],
};

export const PROVIDER_MASCOTS = {
  claude: { frames: MASCOT, palette: MASCOT_PALETTE },
  codex: { frames: CODEX_MASCOT, palette: CODEX_PALETTE },
  opencode: { frames: OPENCODE_MASCOT, palette: OPENCODE_PALETTE },
};

export interface Hat {
  name: string;
  rows: string[]; // bottom row is drawn on the mascot's ear row
  palette: Palette;
}

const hat = (name: string, palette: Palette, ...rows: string[]): Hat => ({ name, rows, palette });

export const HATS: Hat[] = [
  hat("top hat", { "#": 0x202020, "%": 0xb03030 },
    "....####....",
    "....####....",
    "....%%%%....",
    "..########.."),
  hat("cap", { "#": 0x2f6fdb, "%": 0x1f4fa8 },
    "...######...",
    "..########..",
    "..#####%%%%%"),
  hat("party cone", { "#": 0xe040a0, "%": 0xf2d24a, "*": 0xf8f8f8 },
    ".....*......",
    "....%%%.....",
    "....###.....",
    "...%%%%%....",
    "...#####...."),
  hat("crown", { "#": 0xe8b923, "*": 0xd0312d },
    "...#.#.#.#..",
    "...#*#*#*#..",
    "...#######.."),
  hat("beanie", { "#": 0x2e9e5b, "%": 0x1f6b3e, "*": 0xf2f2f2 },
    ".....**.....",
    "..########..",
    "..########..",
    "..%%%%%%%%.."),
  hat("cowboy", { "#": 0x8b5a2b, "%": 0x3a2414 },
    "....####....",
    "....####....",
    "....%%%%....",
    "############"),
  hat("wizard", { "#": 0x6a3fb5, "*": 0xf2d24a },
    ".....#......",
    "....###.....",
    "....#*#.....",
    "...#####....",
    "..#######...",
    ".#########.."),
  hat("chef", { "#": 0xf4f4f4, "%": 0xc8c8c8 },
    "...######...",
    "..########..",
    "..########..",
    "...%%%%%%..."),
  hat("beret", { "#": 0xc03030, "%": 0x9a2626 },
    ".......#....",
    "..#########.",
    ".%%%%%%%%%%."),
  hat("propeller", { "#": 0x2bb5c8, "%": 0x8a8f98, "*": 0xf2f2f2 },
    "..***.%.***.",
    "......%.....",
    "..########..",
    "..########.."),
  hat("hard hat", { "#": 0xf2c511, "%": 0xd9a800 },
    "....####....",
    "..########..",
    ".%%%%%%%%%%."),
  hat("viking", { "#": 0x8a8f98, "*": 0xf2f2f2 },
    ".*........*.",
    ".*........*.",
    "..########..",
    "..########.."),
  hat("sombrero", { "#": 0xd9a066, "%": 0xc0392b },
    ".....##.....",
    "....####....",
    "....%%%%....",
    "############"),
  hat("halo", { "#": 0xf7e27a },
    "...######...",
    "..#......#..",
    "...######...",
    "............"),
  hat("bucket hat", { "#": 0x6b7a3a },
    "....####....",
    "...######...",
    ".##########."),
  hat("grad cap", { "#": 0x202020, "%": 0xf2d24a },
    "############",
    "....####...%",
    "...........%"),
  hat("santa", { "#": 0xc0392b, "*": 0xf2f2f2 },
    "..........*.",
    ".......###..",
    "....######..",
    "..########..",
    ".**********."),
  hat("pirate", { "#": 0x202020, "*": 0xf2f2f2 },
    "....####....",
    "..###**###..",
    ".##########."),
  hat("fez", { "#": 0xb0203a, "*": 0x202020 },
    ".....#.*....",
    "....####....",
    "....####...."),
  hat("detective", { "#": 0x8b5a2b, "%": 0x5c3a1a },
    "....####....",
    "..########..",
    "%##########%"),
];

export interface Accessory extends Sprite {
  name: string;
  // Full mascot width keeps horizontal mirroring aligned with the body.
  // Face accessories follow each provider's eye line; clothes share an anchor.
  y: Record<keyof typeof PROVIDER_MASCOTS, number>;
}

export const ACCESSORIES: Accessory[] = [
  {
    name: "sunglasses",
    y: { claude: 1, codex: 2, opencode: 2 },
    rows: [
      ".#*##==#*##.",
      "..###..###..",
    ],
    palette: { "#": 0x111111, "=": 0x343b46, "*": 0xf2f2f2 },
  },
  {
    name: "round glasses",
    y: { claude: 1, codex: 2, opencode: 2 },
    rows: ["..###..###..", ".#...##...#.", "..###..###.."],
    palette: { "#": 0xe8b923 },
  },
  {
    name: "neon visor",
    y: { claude: 2, codex: 3, opencode: 3 },
    rows: [".##########.", ".#**%%%%**#."],
    palette: { "#": 0x24334d, "%": 0x2bb5c8, "*": 0xb9ffff },
  },
  {
    name: "eye patch",
    y: { claude: 1, codex: 2, opencode: 2 },
    rows: ["..###======.", "..###......."],
    palette: { "#": 0x111111, "=": 0x57483d },
  },
  {
    name: "bow tie",
    y: { claude: 4, codex: 4, opencode: 4 },
    rows: ["...##..##...", "...##**##..."],
    palette: { "#": 0xc03068, "*": 0xf2d24a },
  },
  {
    name: "striped scarf",
    y: { claude: 4, codex: 4, opencode: 4 },
    rows: ["..##%%##%%..", ".......##...", ".......%%..."],
    palette: { "#": 0x2f6fdb, "%": 0xf2d24a },
  },
];

export const BALL: Sprite = {
  rows: [
    ".##.",
    "#*##",
    "##*#",
    ".##.",
  ],
  palette: { "#": C.white, "*": C.black },
};

export const CUP: Sprite = {
  rows: [
    ".*..",
    "###.",
    "###%",
  ],
  palette: { "#": 0xf2f2f2, "%": 0xd0d0d0, "*": 0x9aa0a6 },
};

export const PLANT: Sprite = {
  rows: [
    ".%##%.",
    "%####%",
    ".####.",
    "..##..",
    ".@@@@.",
    ".@@@@.",
    "..@@..",
  ],
  palette: { "#": 0x2e9e5b, "%": 0x3cbf6f, "@": 0x9c5a2b },
};

export const COFFEE_MACHINE: Sprite = {
  rows: [
    ".######.",
    ".#%%%%#.",
    ".#%%%*#.",
    ".######.",
    ".#.@@.#.",
    ".#.@@.#.",
    ".######.",
    "########",
  ],
  palette: { "#": 0x4b5563, "%": 0xc0392b, "*": 0x3adb76, "@": 0xf2f2f2 },
};

export const COUCH: Sprite = {
  rows: [
    ".##############.",
    "################",
    "##%%%%%%%%%%%%##",
    "##%%%%%%%%%%%%##",
    "################",
    ".#............#.",
  ],
  palette: { "#": 0x6d4c8c, "%": 0x8f6bb0 },
};

export const CLOCK: Sprite = {
  rows: [
    ".###.",
    "#.*.#",
    "#.**#",
    "#...#",
    ".###.",
  ],
  palette: { "#": 0xe6e6e6, "*": 0x202020 },
};

export const WHITEBOARD: Sprite = {
  rows: [
    "################",
    "#..............#",
    "#.%%%%..%%%....#",
    "#.%%%%%%%..%%..#",
    "#..%%..%%%%%...#",
    "#..............#",
    "################",
  ],
  palette: { "#": 0xdcdcdc, "%": 0x2f6fdb },
};
