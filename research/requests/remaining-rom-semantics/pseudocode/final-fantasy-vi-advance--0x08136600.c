
void FUN_08136600(void)

{
  ushort uVar1;
  word wVar2;
  ushort uVar3;
  uint uVar4;
  code *UNRECOVERED_JUMPTABLE;
  
  wVar2 = REG_KEYINPUT;
  uVar3 = ~wVar2;
  uRam0300298c = uVar3 & ~uRam03002998;
  uVar1 = uVar3 & uRam0300299c;
  if (uVar1 != 0) {
    if (uVar1 == uRam03002990) {
      uVar1 = uRam03002990;
      if (((uRam0300299c & uRam03002990) != 0) &&
         (uVar4 = (uint)uRam03002994, uRam03002994 = uRam03002994 - 1,
         uVar4 == 0 || (int)(uVar4 * 0x10000) < 0)) {
        uRam0300298c = uRam0300298c | uRam03002990;
        uRam03002994 = 5;
      }
    }
    else {
      uRam03002994 = 0x14;
    }
  }
  uRam03002990 = uVar1;
  if ((cRam030027d0 != '\0') && (uRam03007218 = 0, (bRam03007200 & 0x81) == 0x81)) {
    uRam03007218 = (ushort)((int)-(uVar3 & 1) >> 0x1f) & 0x80;
    if ((uVar3 & 2) != 0) {
      uRam03007218 = uRam03007218 | 0x8000;
    }
    if ((uVar3 & 0x200) != 0) {
      uRam03007218 = uRam03007218 | 0x20;
    }
    if ((uVar3 & 0x100) != 0) {
      uRam03007218 = uRam03007218 | 0x10;
    }
    if ((uVar3 & 4) != 0) {
      uRam03007218 = uRam03007218 | 0x4000;
    }
    if ((uVar3 & 8) != 0) {
      uRam03007218 = uRam03007218 | 0x40;
    }
    if ((uVar3 & 0x40) != 0) {
      uRam03007218 = uRam03007218 | 0x800;
    }
    if ((uVar3 & 0x80) != 0) {
      uRam03007218 = uRam03007218 | 0x400;
    }
    if ((uVar3 & 0x20) != 0) {
      uRam03007218 = uRam03007218 | 0x200;
    }
    if ((uVar3 & 0x10) != 0) {
      uRam03007218 = uRam03007218 | 0x100;
    }
    uRam0300721a = 0;
  }
  uRam03002998 = uVar3;
                    /* WARNING: Could not recover jumptable at 0x0813674c. Too many branches */
                    /* WARNING: Treating indirect jump as call */
  (*UNRECOVERED_JUMPTABLE)();
  return;
}

