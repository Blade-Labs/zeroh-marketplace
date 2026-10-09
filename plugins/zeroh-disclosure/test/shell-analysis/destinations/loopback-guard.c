#define _GNU_SOURCE
#include <arpa/inet.h>
#include <dlfcn.h>
#include <errno.h>
#include <netdb.h>
#include <string.h>
#include <sys/socket.h>
/* Fixture-owned resolver: never forwards a documentation hostname to DNS. */
int getaddrinfo(const char *node,const char *service,const struct addrinfo *h,struct addrinfo **r) {
  int (*next)(const char *,const char *,const struct addrinfo *,struct addrinfo **) = dlsym(RTLD_NEXT,"getaddrinfo");
  struct in_addr v4;
  struct in6_addr v6;
  if (!node) return next(node,service,h,r);
  if (!strcmp(node,"localhost")) return next("127.0.0.1",service,h,r);
  if (inet_pton(AF_INET,node,&v4)==1 && (ntohl(v4.s_addr)>>24)==127) return next(node,service,h,r);
  if (inet_pton(AF_INET6,node,&v6)==1 && IN6_IS_ADDR_LOOPBACK(&v6)) return next(node,service,h,r);
  if (strstr(node,".example.com") || strstr(node,".example")) return next("127.0.0.1",service,h,r);
  return EAI_NONAME;
}
static int local(const struct sockaddr *a) {
  if (!a || a->sa_family==AF_UNIX) return 1;
  if(a->sa_family==AF_INET) return (ntohl(((const struct sockaddr_in*)a)->sin_addr.s_addr)>>24)==127;
  if(a->sa_family==AF_INET6) return IN6_IS_ADDR_LOOPBACK(&((const struct sockaddr_in6*)a)->sin6_addr);
  return 0;
}
int connect(int fd,const struct sockaddr *a,socklen_t n) {
  int (*next)(int,const struct sockaddr *,socklen_t)=dlsym(RTLD_NEXT,"connect");
  if(!local(a)){errno=EPERM;return -1;} return next(fd,a,n);
}
ssize_t sendto(int fd,const void *b,size_t n,int flags,const struct sockaddr *a,socklen_t l) {
  ssize_t (*next)(int,const void*,size_t,int,const struct sockaddr*,socklen_t)=dlsym(RTLD_NEXT,"sendto");
  if(!local(a)){errno=EPERM;return -1;}return next(fd,b,n,flags,a,l);
}
