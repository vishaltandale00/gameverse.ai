
void FUN_0810d2f8(void)

{
  word wVar1;
  char cVar2;
  uint uVar3;
  uint uVar4;
  code *UNRECOVERED_JUMPTABLE;
  
  wVar1 = REG_KEYINPUT;
  uRam03002be8 = ~wVar1 & 0x3ff;
  uRam03003100 = uRam03002be8;
  if (cRam03006fd8 == '\x01') {
    func_0x0811456c(uRam03002be8);
  }
  else if (cRam03006fd8 == '\x02') {
    uRam03003100 = func_0x0811453c();
  }
  uRam03003128 = (uRam03003100 ^ uRam03003f14) & uRam03003100;
  uRam03003b5c = (uRam03003100 ^ uRam03003f14) & uRam03003f14;
  uRam03003f14 = uRam03003100;
  uVar3 = 0;
  uRam03003f6c = uRam03003128;
  do {
    uVar4 = (int)(uVar3 * 0x1000000) >> 0x18;
    if (((int)(uint)uRam03003100 >> (uVar4 & 0xff) & 1U) == 0) {
      *(undefined1 *)(uVar4 + 0x3003110) = *(undefined1 *)(uVar4 + 0x3003b50);
    }
    else {
      cVar2 = *(char *)(uVar4 + 0x3003110);
      if (cVar2 == '\0') {
        uRam03003128 = (ushort)(1 << (uVar4 & 0xff)) | uRam03003128;
        cVar2 = *(char *)(uVar4 + 0x3003c10);
      }
      else {
        cVar2 = cVar2 + -1;
      }
      *(char *)(uVar4 + 0x3003110) = cVar2;
    }
    uVar4 = uVar3 * 0x1000000 + 0x1000000;
    uVar3 = uVar4 >> 0x18;
  } while ((int)uVar4 >> 0x18 < 10);
                    /* WARNING: Could not recover jumptable at 0x0810d3e6. Too many branches */
                    /* WARNING: Treating indirect jump as call */
  (*UNRECOVERED_JUMPTABLE)();
  return;
}

