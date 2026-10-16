#!/usr/bin/env python3
"""Build a native whole-ROM candidate from an executable composition plan.

For archived source-based MZM experiments use build_mzm.py explicitly. New
component compositions use this plan path; behavior is selected by graph inputs.
"""
from tools.composition.native_build import main

if __name__ == '__main__':
    main()
