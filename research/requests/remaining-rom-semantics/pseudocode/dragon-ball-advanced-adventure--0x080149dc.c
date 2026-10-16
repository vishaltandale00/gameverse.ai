
void FUN_080149dc(int param_1)

{
  ushort uVar1;
  char cVar2;
  ushort uVar3;
  char *pcVar4;
  ushort *puVar5;
  code *UNRECOVERED_JUMPTABLE;
  
  uVar3 = uRam03003100;
  if ((*(uint *)(param_1 + 0xc) & 0x400) != 0) {
    uVar3 = 0;
  }
  puVar5 = (ushort *)(param_1 + 0xe2);
  uVar1 = *puVar5;
  *puVar5 = uVar3;
  *(ushort *)(param_1 + 0xe4) = uVar3 & ~uVar1;
  *(ushort *)(param_1 + 0xe6) = uVar1 & ~*puVar5;
  uVar3 = *(ushort *)(param_1 + 0xe4) & 0x30f;
  *(ushort *)(param_1 + 0xe8) = uVar3;
  if ((*puVar5 & 0xf0) == 0) {
    cVar2 = '\x10';
  }
  else {
    pcVar4 = (char *)(param_1 + 0xe1);
    if (((*pcVar4 == '\0') || (*pcVar4 == '\x10')) &&
       (*(ushort *)(param_1 + 0xe8) = uVar3 | *puVar5 & 0xf0, *pcVar4 == '\0')) {
      *pcVar4 = '\b';
    }
    cVar2 = *pcVar4 + -1;
  }
  *(char *)(param_1 + 0xe1) = cVar2;
                    /* WARNING: Could not recover jumptable at 0x08014a68. Too many branches */
                    /* WARNING: Treating indirect jump as call */
  (*UNRECOVERED_JUMPTABLE)();
  return;
}

