
void FUN_08065344(void)

{
  ushort uVar1;
  word wVar2;
  uint uVar3;
  ushort uVar4;
  code *UNRECOVERED_JUMPTABLE;
  
  wVar2 = REG_KEYINPUT;
  uVar1 = ~wVar2;
  uVar4 = uVar1 & 0x3ff;
  if (((uVar1 & 0x300) == 0) && ((uVar1 & 0xf) == 0xf)) {
    func_0x080652a0();
  }
  uRam02000cea = uVar4 & ~uRam02000ce4;
  uRam02000ce8 = uVar4;
  if (sRam02000d08 == 2) {
    uVar3 = uRam0200048c + 1;
    uRam0200048c = (ushort)uVar3;
    *(ushort *)((uVar3 & 0x1f) * 2 + 0x2000420) = uVar4;
    if (uRam02000ce8 != *(ushort *)((uRam0200048c - 1 & 0x1f) * 2 + 0x2000420)) {
      cRam02036320 = cRam02036320 + '\x01';
      bRam0203632c = (byte)uVar3;
    }
    if (0xc < (uRam0200048c - bRam0203632c & 0xff)) {
      bRam0203632c = (char)uRam0200048c - 0xc;
    }
    *(char *)((uRam0200048c & 0x1f) + 0x20003c0) = cRam02036320;
    *(byte *)((uRam0200048c & 0x1f) + 0x2000e80) = bRam0203632c;
  }
  if ((uVar1 & 0xf) == 0xf) {
    func_0x0806b4dc(0xff);
  }
                    /* WARNING: Could not recover jumptable at 0x080653fc. Too many branches */
                    /* WARNING: Treating indirect jump as call */
  (*UNRECOVERED_JUMPTABLE)();
  return;
}

