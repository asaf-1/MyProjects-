import random
import sys

# =========================================
# Fantasy Dice Quest (Text RPG, FF-style)
# Roll a die -> jump to a new map tile -> fight (turn-based)
# Goal: clear every tile on the map, then reveal the full map.
# =========================================

W, H = 5, 5  # Map size

TILES = ["PLAINS", "FOREST", "RUINS", "CAVE", "SWAMP", "MOUNTAIN", "VILLAGE"]
TILE_CODE = {
    "PLAINS": "PL",
    "FOREST": "FO",
    "RUINS": "RU",
    "CAVE": "CA",
    "SWAMP": "SW",
    "MOUNTAIN": "MT",
    "VILLAGE": "VI",
    "BOSS": "BO",
}

MONSTERS_BY_TILE = {
    "PLAINS":   [("Slime", 18, 6, 2), ("Wolf", 22, 7, 3)],
    "FOREST":   [("Goblin", 24, 8, 3), ("Vine Beast", 28, 9, 4)],
    "RUINS":    [("Skeleton", 26, 9, 4), ("Haunted Armor", 32, 10, 5)],
    "CAVE":     [("Bat Swarm", 20, 8, 2), ("Rock Golem", 36, 11, 6)],
    "SWAMP":    [("Bog Witch", 30, 10, 4), ("Leech Horror", 34, 10, 5)],
    "MOUNTAIN": [("Harpy", 28, 11, 4), ("Frost Troll", 40, 12, 6)],
    "VILLAGE":  [("Bandit", 26, 9, 3)],
}
BOSS = ("Ancient Dragon", 85, 15, 8)

# -------------------------
# Player / Monster
# -------------------------
class Player:
    def __init__(self, name="Hero"):
        self.name = name
        self.max_hp = 75
        self.hp = self.max_hp
        self.max_mp = 20
        self.mp = self.max_mp
        self.atk = 12
        self.defn = 6
        self.potions = 3
        self.gold = 0
        self.defending = False

class Monster:
    def __init__(self, name, hp, atk, defn):
        self.name = name
        self.max_hp = hp
        self.hp = hp
        self.atk = atk
        self.defn = defn
        self.enraged = False

# -------------------------
# Helpers
# -------------------------
def clamp(v, lo, hi):
    return max(lo, min(hi, v))

def damage(attack, defense):
    base = attack - defense
    return max(1, base + random.randint(-1, 2))

def make_map(seed=None):
    if seed is not None:
        random.seed(seed)

    grid = []
    for y in range(H):
        row = []
        for x in range(W):
            row.append(random.choice(TILES))
        grid.append(row)

    # Start is safe-ish, boss in far corner
    grid[0][0] = "VILLAGE"
    grid[H - 1][W - 1] = "BOSS"
    return grid

def build_path_order():
    # Snake path across the grid so dice always moves somewhere
    path = []
    for y in range(H):
        if y % 2 == 0:
            for x in range(W):
                path.append((x, y))
        else:
            for x in reversed(range(W)):
                path.append((x, y))
    return path

PATH = build_path_order()

def pick_next_pos(current_pos, dice_value):
    idx = PATH.index(current_pos)
    return PATH[(idx + dice_value) % len(PATH)]

def in_bounds(x, y):
    return 0 <= x < W and 0 <= y < H

def reveal_neighbors(revealed, pos, radius=1):
    px, py = pos
    for dy in range(-radius, radius + 1):
        for dx in range(-radius, radius + 1):
            nx, ny = px + dx, py + dy
            if in_bounds(nx, ny):
                revealed.add((nx, ny))

def make_monster_for_tile(tile_type):
    if tile_type == "BOSS":
        return Monster(*BOSS)

    candidates = MONSTERS_BY_TILE.get(tile_type, [("Strange Beast", 25, 8, 3)])
    name, hp, atk, defn = random.choice(candidates)

    # Small random scaling for variety
    hp += random.randint(-3, 6)
    atk += random.randint(-1, 2)
    defn += random.randint(-1, 1)

    return Monster(name, max(10, hp), max(4, atk), max(1, defn))

# -------------------------
# Map Rendering
# -------------------------
def print_legend():
    print("\n🗺️  Legend:")
    print("  VI = Village, PL = Plains, FO = Forest, RU = Ruins")
    print("  CA = Cave, SW = Swamp, MT = Mountain, BO = Boss Lair")
    print("  ?? = Unknown (Fog of War)")
    print("  [] = Cleared tile")
    print("  PP = Your position (uncleared tile)")
    print("  PC = Your position (cleared tile)\n")

def render_map(grid, revealed, cleared, player_pos, show_full=False):
    print("┌" + "────" * W + "┐")
    for y in range(H):
        cells = []
        for x in range(W):
            pos = (x, y)
            if pos == player_pos:
                # KEY FIX: show immediate change after clearing current tile
                cell = "PC" if pos in cleared else "PP"
            else:
                if show_full or pos in revealed:
                    tile = grid[y][x]
                    cell = "[]" if pos in cleared else TILE_CODE[tile]
                else:
                    cell = "??"
            cells.append(cell)
        print("│" + "".join([f" {c} " for c in cells]) + "│")
    print("└" + "────" * W + "┘")

# -------------------------
# Combat (Turn-based)
# -------------------------
def combat(player: Player, monster: Monster):
    print(f"\n⚔️  Battle Start! You encountered: {monster.name} (HP {monster.hp}/{monster.max_hp})")

    player.defending = False
    monster.enraged = False

    while player.hp > 0 and monster.hp > 0:
        print("\n" + "-" * 55)
        print(f"🧙 {player.name} | HP {player.hp}/{player.max_hp} | MP {player.mp}/{player.max_mp} | Potions {player.potions} | Gold {player.gold}")
        print(f"👹 {monster.name} | HP {monster.hp}/{monster.max_hp}")
        print("-" * 55)

        # Player turn
        print("Choose an action:")
        print("1) Attack   2) Magic (Fire: 6 MP)   3) Defend   4) Potion   5) Run")
        choice = input("> ").strip()

        if choice == "1":
            hit = damage(player.atk, monster.defn)
            monster.hp = max(0, monster.hp - hit)
            print(f"🗡️  You attack! You deal {hit} damage to {monster.name}.")
            player.defending = False

        elif choice == "2":
            cost = 6
            if player.mp < cost:
                print("❌ Not enough MP (need 6).")
            else:
                player.mp -= cost
                hit = damage(player.atk + 6, monster.defn // 2)
                monster.hp = max(0, monster.hp - hit)
                print(f"🔥 Fire! You deal {hit} magic damage to {monster.name}.")
                player.defending = False

        elif choice == "3":
            player.defending = True
            print("🛡️  You brace yourself! Next incoming damage is reduced.")

        elif choice == "4":
            if player.potions <= 0:
                print("❌ No potions left.")
            else:
                player.potions -= 1
                heal = random.randint(18, 28)
                player.hp = clamp(player.hp + heal, 0, player.max_hp)
                print(f"🧪 You drink a potion and heal {heal} HP.")
                player.defending = False

        elif choice == "5":
            chance = 45
            roll = random.randint(1, 100)
            if roll <= chance:
                print("🏃 You successfully ran away!")
                return "RAN"
            else:
                print("😬 You failed to escape!")
                player.defending = False

        else:
            print("❓ Invalid choice — you lose your turn.")
            player.defending = False

        if monster.hp <= 0:
            break

        # Monster turn
        if monster.hp <= monster.max_hp * 0.35 and not monster.enraged:
            monster.enraged = True
            monster.atk += 3
            print(f"😡 {monster.name} becomes enraged! Its attack increases!")

        if random.random() < 0.18:
            hit = damage(monster.atk + 3, player.defn * (2 if player.defending else 1))
            player.hp = max(0, player.hp - hit)
            print(f"💥 {monster.name} uses a special strike! You take {hit} damage.")
        else:
            hit = damage(monster.atk, player.defn * (2 if player.defending else 1))
            player.hp = max(0, player.hp - hit)
            print(f"👊 {monster.name} attacks! You take {hit} damage.")

        player.defending = False

    if player.hp <= 0:
        print("\n💀 You were defeated... Game Over.")
        return "DEAD"

    # Rewards
    reward = random.randint(8, 18)
    player.gold += reward

    drop = random.random()
    if drop < 0.20:
        player.potions += 1
        print(f"\n🏆 Victory! You defeated {monster.name}. You gain {reward} gold and found a Potion! 🎁")
    elif drop < 0.28:
        player.max_hp += 3
        player.hp = player.max_hp
        print(f"\n🏆 Victory! You defeated {monster.name}. You gain {reward} gold and your Max HP increases by 3! 💪")
    else:
        print(f"\n🏆 Victory! You defeated {monster.name}. You gain {reward} gold.")

    mp_regen = random.randint(2, 5)
    player.mp = clamp(player.mp + mp_regen, 0, player.max_mp)
    print(f"✨ Recovery: +{mp_regen} MP (now {player.mp}/{player.max_mp})")

    return "WIN"

# -------------------------
# Game Loop
# -------------------------
def all_tiles_cleared(cleared_set):
    return len(cleared_set) >= (W * H)

def main():
    print("🎲⚔️  Fantasy Dice Quest (Mini FF-style)")
    print("Goal: Roll the die, travel the map, clear every tile, survive.\n")

    name = input("Enter your hero name (or press Enter for Hero): ").strip() or "Hero"
    player = Player(name)

    grid = make_map()
    revealed = set()
    cleared = set()

    pos = (0, 0)
    reveal_neighbors(revealed, pos, radius=1)

    print_legend()

    while True:
        print("\n==============================")
        print("📍 Map (Fog of War):")
        render_map(grid, revealed, cleared, pos, show_full=False)
        print(f"Progress: {len(cleared)}/{W*H} tiles cleared")

        if all_tiles_cleared(cleared):
            print("\n🌟 You cleared the entire map!")
            break

        tile = grid[pos[1]][pos[0]]
        print(f"\n🧭 You are at: {tile} ({TILE_CODE[tile]})")

        # Encounter if not cleared
        if pos not in cleared:
            print("👣 This tile is not cleared yet...")
            monster = make_monster_for_tile(tile)
            result = combat(player, monster)

            if result == "DEAD":
                sys.exit(0)
            elif result == "RAN":
                print("🚪 You escaped — the tile remains uncleared.")
            else:
                # Mark current tile as cleared
                cleared.add(pos)
                print("✅ Tile cleared!")

                # KEY FIX: show map update immediately (now you'll see PC on this tile)
                print("\n🗺️  Map updated after victory:")
                render_map(grid, revealed, cleared, pos, show_full=False)
                print(f"Progress: {len(cleared)}/{W*H} tiles cleared")

        else:
            # Small rest bonus
            if random.random() < 0.35:
                heal = random.randint(4, 9)
                player.hp = clamp(player.hp + heal, 0, player.max_hp)
                player.mp = clamp(player.mp + 2, 0, player.max_mp)
                print(f"🕯️ Quiet place... You recover a bit (+{heal} HP, +2 MP).")

        # Travel by dice roll
        print("\n🎲 Press Enter to roll the die and travel...")
        input()

        roll = random.randint(1, 6)
        pos = pick_next_pos(pos, roll)
        reveal_neighbors(revealed, pos, radius=1)

        tile2 = grid[pos[1]][pos[0]]
        flavor = [
            "A cold wind cuts through the trees...",
            "You hear footsteps behind you — but see nothing.",
            "The ground trembles for a moment, then goes still.",
            "A strange blue light flickers in the distance.",
            "You smell smoke — someone was here recently.",
        ]
        print(f"🎲 You rolled {roll}! You move to a new place...")
        print(f"📌 You arrived at: {tile2} ({TILE_CODE[tile2]}) — {random.choice(flavor)}")

    print("\n==============================")
    print("🗺️  Full Map (Revealed):")
    render_map(grid, revealed, cleared, pos, show_full=True)
    print(f"\n🏁 Well done, {player.name}! Final Gold: {player.gold} | HP: {player.hp}/{player.max_hp}\n")

if __name__ == "__main__":
    main()
