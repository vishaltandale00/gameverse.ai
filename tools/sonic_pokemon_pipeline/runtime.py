"""Invoke the reviewed source/ROM dependency transfer; no synthesized game code."""
import argparse
from pathlib import Path
from enemy_assets import apply

def main():
    parser=argparse.ArgumentParser()
    for name in ['sonic','leaf','sonic-source','pokemon-source','out']:
        parser.add_argument('--'+name,type=Path,required=True)
    args=parser.parse_args()
    apply(args.sonic,args.leaf,args.sonic_source,args.pokemon_source,args.out)
if __name__=='__main__':main()
