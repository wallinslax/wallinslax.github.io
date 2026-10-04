---
title: 'Why I switched my career from SRE to SWE'
description: 'From configuring other companies’ products to building my own: the story behind moving from Site Reliability Engineering to Software Engineering.'
pubDate: 2021-09-15
tags: ['career', 'sre']
visibility: public
---

> Originally posted on [LinkedIn](https://www.linkedin.com/posts/activity-6843957426618810368-MlBA) in September 2021.

I would like to share the story why I want to switch my career from SRE to SWE.

In SRE position, we use some companies' products to build our service, aka IaaS, SaaS and PaaS. Take IaaS as an example, we use VMware Hypervisor, NetApp Storage and Cisco Switch to build virtual environments where users can create VMs and deploy their service on those computational resources. One of SRE's responsibilities is to keep service deployment as smooth as possible. It is all about configuration. Those VMs vary depending on customers' needs. For SRE, those VMs can be generated with dedicated configuration templates. Some VMs are WEB with Apache. Some VMs are LOG with ELK. So we introduce configuration management tools such as Ansible, Puppet, Salt and Chef. Try to draw the template playbooks that a specific VM should look like. We always use other's product to help our service better and follow the guideline.

Another SRE responsibility is to keep infrastructure as secure as possible. There are thousands of guidelines from ISO 27001 that an infrastructure should follow, like a Linux VM should turn off root remote login. That does cultivate our sense of security. Moreover, we try to earn as many licenses as we can, such as CCNP, CCIE, VCP and so on, to prove we know how to use their products. In fact, we are followers of software industries. Hopefully, there comes Docker, OpenStack and SDN. That's another story.

One day, the network team announced a new policy that no server can directly SSH to all servers according to ISO 27001, i.e., different zones should have their own jump server. It brings great challenges to daily administration since company-wide configuration deployment can no longer be done from a single administration server. It stimulates our software development journey using Python and corresponding libraries. The key concept is to "cumulate" the connection ability of those servers into a single server so that we can do the same thing as usual. Hmm, kind of SSH tunnel, isn't it? After a few months, we finally released our tool. From this experience, I no longer use other products to build my own. I create it by myself. It brings a lot of sense of achievement. I know I was not so rigid at data structures and algorithms at that time and had little experience in design patterns. That's why I went to USC to earn a CS MS degree.

It doesn't mean SRE is worthless. SRE has the strongest high-availability sense to ensure 24/365 services, and rigid security discipline to earn customer trust, which is the most important part for a service provider. Moreover, even a junior SRE has a strong system design background since they always handle the entire scope of the service pipeline.

I am so into SWE because I can truly build my product by my bare hands, literally every single line. If there is any software internship available, please kindly let me know. I will let you know my passion.
