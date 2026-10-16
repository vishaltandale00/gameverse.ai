
void FUN_0811ab18(int param_1)

{
  int iVar1;
  undefined2 *puVar2;
  int iVar3;
  int iVar4;
  code *UNRECOVERED_JUMPTABLE;
  
  *(undefined1 *)(param_1 + 0x2c4) = 0;
  *(undefined1 *)(param_1 + 0x2c5) = 2;
  *(undefined1 *)(param_1 + 0x2c6) = 2;
  *(undefined1 *)(param_1 + 0x2c7) = 0;
  *(undefined1 *)(param_1 + 0x2c8) = 0;
  *(undefined1 *)(param_1 + 0x2c9) = 0;
  *(undefined1 *)(param_1 + 0x2ca) = 0;
  *(undefined1 *)(param_1 + 0x2cb) = 1;
  *(undefined1 *)(param_1 + 0x2cc) = 0;
  *(undefined1 *)(param_1 + 0x2cd) = 0;
  *(undefined1 *)(param_1 + 0x2ce) = 0;
  *(undefined1 *)(param_1 + 0x344) = 0;
  *(undefined2 *)(param_1 + 0x2d2) = 0x7fff;
  iVar3 = 0;
  do {
    iVar1 = FUN_08152254(iVar3,0x80f5209);
    iVar4 = iVar3 + 1;
    puVar2 = (undefined2 *)(iVar3 * 0xe + param_1 + 0x2d4);
    iVar3 = 6;
    do {
      *puVar2 = *(undefined2 *)(iVar1 + 2);
      iVar1 = iVar1 + 2;
      puVar2 = puVar2 + 1;
      iVar3 = iVar3 + -1;
    } while (-1 < iVar3);
    iVar3 = iVar4;
  } while (iVar4 < 8);
                    /* WARNING: Could not recover jumptable at 0x0811abac. Too many branches */
                    /* WARNING: Treating indirect jump as call */
  (*UNRECOVERED_JUMPTABLE)();
  return;
}

