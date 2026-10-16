
void FUN_080011dc(void)

{
  word wVar1;
  code *UNRECOVERED_JUMPTABLE;
  
  wVar1 = REG_KEYINPUT;
  uRam0300100c = wVar1 ^ 0x3ff;
  uRam03000038 = uRam0300100c & ~uRam03001ef4;
  if ((uRam0300100c == 0) || (uRam03001ef4 != uRam0300100c)) {
    uRam03000b70 = uRam03000038;
    if ((uRam03001ef4 & 0xf0) == 0) {
      uRam03001670 = uRam03000fc8;
    }
  }
  else {
    uRam03001670 = uRam03001670 - 1;
    if (uRam03001670 == 0 || (int)((uint)uRam03001670 * 0x10000) < 0) {
      uRam03001670 = uRam03001ecc;
      uRam03000b70 = uRam0300100c;
    }
    else {
      uRam03000b70 = 0;
    }
  }
  uRam03001ef4 = uRam0300100c;
                    /* WARNING: Could not recover jumptable at 0x08001270. Too many branches */
                    /* WARNING: Treating indirect jump as call */
  (*UNRECOVERED_JUMPTABLE)();
  return;
}

