
void FUN_08152694(void)

{
  word wVar1;
  char cVar2;
  uint uVar3;
  uint uVar4;
  code *UNRECOVERED_JUMPTABLE;
  
  uRam030039a8 = uRam03002e90;
  wVar1 = REG_KEYINPUT;
  uRam03002480 = ~wVar1 & 0x3ff;
  uRam03002e90 = uRam03002480;
  if (cRam03006cb8 == '\x01') {
    func_0x08158238(uRam03002480);
  }
  else if (cRam03006cb8 == '\x02') {
    uRam03002e90 = func_0x08158208();
  }
  uRam03002eb8 = (uRam03002e90 ^ uRam030039a8) & uRam03002e90;
  uRam030035ec = (uRam03002e90 ^ uRam030039a8) & uRam030039a8;
  uVar3 = 0;
  uRam030039fc = uRam03002eb8;
  do {
    uVar4 = (int)(uVar3 * 0x1000000) >> 0x18;
    if (((int)(uint)uRam03002e90 >> (uVar4 & 0xff) & 1U) == 0) {
      *(undefined1 *)(uVar4 + 0x3002ea0) = *(undefined1 *)(uVar4 + 0x30035e0);
    }
    else {
      cVar2 = *(char *)(uVar4 + 0x3002ea0);
      if (cVar2 == '\0') {
        uRam03002eb8 = (ushort)(1 << (uVar4 & 0xff)) | uRam03002eb8;
        cVar2 = *(char *)(uVar4 + 0x30036a0);
      }
      else {
        cVar2 = cVar2 + -1;
      }
      *(char *)(uVar4 + 0x3002ea0) = cVar2;
    }
    uVar4 = uVar3 * 0x1000000 + 0x1000000;
    uVar3 = uVar4 >> 0x18;
  } while ((int)uVar4 >> 0x18 < 10);
                    /* WARNING: Could not recover jumptable at 0x0815278e. Too many branches */
                    /* WARNING: Treating indirect jump as call */
  (*UNRECOVERED_JUMPTABLE)();
  return;
}

